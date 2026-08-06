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

const MAX_BYTES = 15 * 1024 * 1024; // 15MB — generous for a phone photo

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
 * @param file    an image File/Blob (jpeg, png, webp, heic-as-jpeg from most phones)
 * @param catIds  array of valid category id strings to choose from
 * @returns {Promise<{merchant,date,amount,category,confidence,itemsSummary}>}
 */
export async function analyzeReceipt(file, catIds) {
  if (!file) throw new Error('No image to analyze.');
  if (file.size > MAX_BYTES) {
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
