/**
 * Reduce a bank statement description to a stable merchant name.
 *
 * Statements bury the merchant in noise that changes every month, which makes
 * the same subscription look like a different payee each time:
 *
 *   [OP]RECURRING PYMNT 19JAN2026FREEDOM MOBILE ON   → freedom mobile
 *   [OP]RECURRING PYMNT 19APR2026FREEDOM MOBILE ON   → freedom mobile
 *   DROPBOX*CG9F5CS6N7G1                             → dropbox
 *   Dropbox RL41LSWNT7HJ                             → dropbox
 *   [CW]INTERAC ETRNSFR SENT STELA 20260051757M8FCYA → stela
 *
 * Without this, four charges from one payee are four separate one-offs and
 * nothing is ever recognised as a bill.
 */

// [PR] [CW] [OP] [SC] [DC] [DN] — BMO transaction class codes
const BRACKET_CODE = /\[[A-Z]{2}\]/g;

// 19JAN2026 glued to the merchant name, sometimes with no space after
const EMBEDDED_DATE = /\b\d{1,2}(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\d{2,4}/gi;

// Bank boilerplate that says how the money moved, not who received it
const BOILERPLATE = new RegExp([
  'recurring\\s*pymnt', 'interac\\s*e-?trnsfr', 'e-?transfer',
  'ad\\s*recvd', 'fulfill', '\\bsent\\b', '\\brecvd\\b', '\\bpymnt\\b',
  'point\\s*of\\s*sale', 'pre-?auth(orized)?\\s*(debit|payment)?',
  'online\\s*(banking\\s*)?(transfer|payment)', 'bill\\s*payment',
  'purchase\\s*from', '\\bpos\\b', '\\bwww\\b', '\\bcom\\b',
].join('|'), 'gi');

// Payment processors that prefix the real merchant
const PROCESSOR = /^(sq|tst|sp|py|pp|paypal|amzn mktp|amz|dd|ub|lyft|intl?)\s*[\*\-#]?\s*/i;

// Canadian province and country tails: "TORONTO ON CAN", "... NS"
const GEO_TAIL = /\s+(ab|bc|mb|nb|nl|ns|nt|nu|on|pe|qc|sk|yt)(\s+(can|usa|us))?\s*$/i;
const COUNTRY_TAIL = /\s+(can|usa|us)\s*$/i;

/** A token like CG9F5CS6N7G1 or 20260051757M8FCYA — a reference, not a name. */
const isReference = t =>
  t.length >= 5 && /\d/.test(t) && /[a-z]/i.test(t) && !/^\d+(st|nd|rd|th)$/i.test(t);

export function merchantKey(description) {
  let s = String(description || '');

  // BMO pads to fixed width, so the merchant sits before a run of spaces and
  // the city/province follow. Cut there while the padding still exists.
  const padded = s.match(/^(.*?)\s{3,}/);
  if (padded && padded[1].replace(BRACKET_CODE, '').trim().length >= 4) {
    s = padded[1];
  }

  s = s
    .replace(BRACKET_CODE, ' ')
    .replace(EMBEDDED_DATE, ' ')
    .replace(PROCESSOR, ' ')
    .replace(/[\*#]/g, ' ')
    .replace(BOILERPLATE, ' ')
    .replace(GEO_TAIL, ' ')
    .replace(COUNTRY_TAIL, ' ');

  const tokens = s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter(t => !isReference(t))            // drop reference codes
    .filter(t => !/^\d{4,}$/.test(t))        // drop long numbers
    .filter(t => !['inc','ltd','corp','co','the','on','ca','cad'].includes(t));

  // Two or three tokens is enough to identify a payee and avoids splitting on
  // store numbers or branch names appended to the end.
  const key = tokens.slice(0, 3).join(' ').trim();
  return key || String(description || '').toLowerCase().trim();
}

/** Pick the tidiest of several raw descriptions to show the user. */
export function bestLabel(descriptions) {
  const cleaned = descriptions.map(d => {
    const padded = String(d).match(/^(.*?)\s{3,}/);
    let s = (padded ? padded[1] : String(d))
      .replace(BRACKET_CODE, ' ')
      .replace(EMBEDDED_DATE, ' ')
      .replace(BOILERPLATE, ' ')
      .replace(/[\*#]/g, ' ')
      .replace(GEO_TAIL, ' ')
      .replace(COUNTRY_TAIL, ' ');
    s = s.split(/\s+/).filter(t => !isReference(t)).join(' ');
    return s.replace(/\s{2,}/g, ' ').trim();
  }).filter(Boolean);

  if (!cleaned.length) return descriptions[0] || '';
  // Shortest is usually the least cluttered
  return cleaned.sort((a, b) => a.length - b.length)[0];
}
