/**
 * Split a PDF into small batches of pages.
 *
 * A serverless function has a hard execution ceiling (roughly 10-26s on
 * Netlify). Asking Claude to read a twelve-page statement in one request blows
 * straight through it and returns a 504 gateway timeout. Several short requests
 * each finish comfortably inside the limit, and they give us real progress to
 * show the user instead of a spinner that sits there for a minute.
 */
let _pdfLib = null;
async function loadPdfLib() {
  if (!_pdfLib) _pdfLib = (await import('pdf-lib')).PDFDocument;
  return _pdfLib;
}

const CHUNK = 0x8000;

function bytesToBase64(bytes) {
  const parts = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)));
  }
  return btoa(parts.join(''));
}

/** How many pages does this document have? */
export async function pageCount(file) {
  const PDFDocument = await loadPdfLib();
  const doc = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: true });
  return doc.getPageCount();
}

/**
 * Returns [{ base64, from, to }] — one entry per batch, pages 1-indexed
 * for display.
 */
export async function splitPDF(file, pagesPerBatch = 3) {
  const PDFDocument = await loadPdfLib();
  const buf = await file.arrayBuffer();
  const src = await PDFDocument.load(buf, { ignoreEncryption: true });
  const total = src.getPageCount();

  // Small documents go through whole — splitting would only add round trips
  if (total <= pagesPerBatch) {
    return [{ base64: bytesToBase64(new Uint8Array(buf)), from: 1, to: total, total }];
  }

  const batches = [];
  for (let start = 0; start < total; start += pagesPerBatch) {
    const end     = Math.min(start + pagesPerBatch, total);
    const out     = await PDFDocument.create();
    const indices = Array.from({ length: end - start }, (_, i) => start + i);
    const pages   = await out.copyPages(src, indices);
    pages.forEach(p => out.addPage(p));

    batches.push({
      base64: bytesToBase64(await out.save()),
      from:   start + 1,
      to:     end,
      total,
    });
  }
  return batches;
}
