import { MODEL_SMART } from './models.js';
import { callClaude, textOf } from './claude.js';

/**
 * Photo-of-a-paper-receipt parser using Claude's native image vision.
 *
 * Mirrors pdf.js's approach (same model, same callClaude/textOf plumbing) but
 * for a single receipt photo instead of a multi-page bank statement: extract
 * merchant, date, total, and a best-guess spending category so the person can
 * confirm it in a couple of taps instead of typing the whole thing by hand.
 */

// iPhones save photos as HEIC/HEIF by default (Settings > Camera > Formats >
// High Efficiency). Claude's vision API only accepts jpeg/png/gif/webp — a
// HEIC file's actual bytes don't match any of those, so declaring it as
// "image/jpeg" (the old fallback) sends genuinely mismatched data and the
// read fails or comes back wrong. Exported so callers can check this BEFORE
// spending an upload on a file that's going to fail anyway.
export const HEIC_TYPES = ['image/heic', 'image/heif'];
export function isHeic(file) {
  if (HEIC_TYPES.includes((file.type || '').toLowerCase())) return true;
  // Some mobile browsers don't populate file.type for HEIC at all — fall
  // back to the filename extension, which is still usually present.
  return /\.hei[cf]$/i.test(file.name || '');
}

export const MAX_RECEIPT_BYTES = 15 * 1024 * 1024; // 15MB — generous for a phone photo

function buildPrompt(catIds) {
  return `You are reading a photo of a paper receipt for a Canadian household budget app.

Extract the following:
- merchant: the store or business name as printed (short, e.g. "Loblaws", not the full corporate name)
- date: the purchase date as YYYY-MM-DD. If the year isn't visible, assume the most recent plausible year.
- amount: the FINAL TOTAL actually paid (after tax and tip if shown), as a positive number
- category: pick EXACTLY one of these category IDs, based on the merchant and items purchased:
${catIds.join(', ')}
- confidence: "high", "medium", or "low" — how legible and certain this reading is
- itemsSummary: one short phrase describing what was bought, if line items are visible (optional)

Return ONLY a JSON object, no markdown fences, no explanation:
{"merchant":"...","date":"YYYY-MM-DD","amount":12.34,"category":"...","confidence":"high","itemsSummary":"..."}

If the photo does not show a receipt at all (blank, unrelated, or unreadable), return exactly:
{"error":"not_a_receipt"}`;
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(new Error('Could not read that image file.'));
    reader.readAsDataURL(file);
  });
}

/**
 * @param file    an image File/Blob — jpeg, png, webp, or gif. HEIC is
 *                rejected with a clear message before this is even called
 *                (see isHeic above); Claude's vision API can't read it.
 * @param catIds  array of valid category id strings to choose from
 * @returns {Promise<{merchant,date,amount,category,confidence,itemsSummary}>}
 */
export async function analyzeReceipt(file, catIds) {
  if (!file) throw new Error('No image to analyze.');
  if (isHeic(file)) {
    throw new Error(
      "That photo is in Apple's HEIC format, which this can't read directly. " +
      'Easiest fix: use "Choose a file" instead of the camera roll picker for this one — ' +
      'it converts automatically. Or in Settings > Camera > Formats, switch to "Most Compatible" ' +
      'so new photos save as JPEG.'
    );
  }
  if (file.size > MAX_RECEIPT_BYTES) {
    throw new Error('That photo is larger than 15MB — try retaking it at a lower resolution.');
  }

  const base64 = await fileToBase64(file);
  const media_type = /png|webp|gif/.test(file.type) ? file.type : 'image/jpeg';

  const data = await callClaude({
    model: MODEL_SMART,
    max_tokens: 400,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type, data: base64 } },
        { type: 'text', text: buildPrompt(catIds) },
      ],
    }],
  });

  let parsed;
  try {
    parsed = JSON.parse(textOf(data));
  } catch {
    throw new Error("Couldn't read that receipt clearly — try a straighter, better-lit photo.");
  }

  if (parsed.error === 'not_a_receipt') {
    throw new Error("That doesn't look like a receipt — try a clearer photo of the whole thing.");
  }

  return {
    merchant:     parsed.merchant || 'Unknown merchant',
    date:         /^\d{4}-\d{2}-\d{2}$/.test(parsed.date) ? parsed.date : new Date().toISOString().slice(0, 10),
    amount:       Math.abs(parseFloat(parsed.amount) || 0),
    category:     catIds.includes(parsed.category) ? parsed.category : 'other',
    confidence:   parsed.confidence || 'medium',
    itemsSummary: parsed.itemsSummary || '',
  };
}

// ─── Making a phone photo safe to handle ──────────────────────────────────────
// A modern phone photo is 12MP+ and 3-15MB. Turning that straight into a
// base64 string (which the vision API needs) produces a ~20MB string, and
// doing that on mobile Safari is a memory spike big enough to kill the tab
// — the "it keeps crashing" everyone hits. Downscaling first takes a
// typical receipt photo under 500KB, which is both survivable and plenty
// of resolution to read a receipt.
//
// It also solves HEIC for free: Safari can DECODE HeIC into a canvas even
// though it can't hand the raw bytes to an API. Drawing it and re-encoding
// as JPEG converts it, so an iPhone photo just works instead of being
// rejected. The explicit HEIC error stays as a fallback for browsers that
// genuinely can't decode it.
export const MAX_EDGE = 1600;      // px on the longest side
export const JPEG_QUALITY = 0.85;

/** Pure: the scale factor to bring an image within MAX_EDGE. Never
 *  upscales — a small photo is left exactly as it is. */
export function scaleFactorFor(width, height, maxEdge = MAX_EDGE) {
  const longest = Math.max(width, height);
  if (!longest || longest <= maxEdge) return 1;
  return maxEdge / longest;
}

/** Downscale + re-encode to JPEG. Returns the original file untouched if
 *  anything goes wrong, so this can only ever help, never block a scan. */
export async function normalizeReceiptImage(file) {
  if (typeof document === 'undefined' || typeof createImageBitmap === 'undefined') return file;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = scaleFactorFor(bitmap.width, bitmap.height);
    // Already small AND already a format the API accepts — nothing to do.
    if (scale === 1 && /jpeg|jpg|png|webp/.test(file.type || '')) {
      bitmap.close?.();
      return file;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY));
    if (!blob) return file;
    return new File([blob], (file.name || 'receipt').replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file; // decode failed — let the normal path deal with it
  }
}
