import { MODEL_FAST } from './models.js';
import { callClaude, textOf } from './claude.js';
/**
 * Bank / account auto-detection.
 * The user should never have to tell us which bank a file came from —
 * the statement almost always says so. We try fingerprints first (instant,
 * free), then fall back to asking Claude, then finally ask the user.
 */


// Known institutions. `id` is what gets stored on each transaction row.
export const INSTITUTIONS = [
  { id:'BMO',      label:'BMO Chequing',        kind:'bank',   color:'#1d4ed8' },
  { id:'CTFS',     label:'Canadian Tire',        kind:'credit', color:'#c0392b' },
  { id:'WS_JOINT', label:'Wealthsimple Joint',   kind:'bank',   color:'#0891b2' },
  { id:'WS_PERS',  label:'Wealthsimple Personal',kind:'bank',   color:'#0369a1' },
  { id:'PC_MC',    label:'PC Mastercard',        kind:'credit', color:'#b45309' },
  { id:'CIBC',     label:'CIBC',                 kind:'bank',   color:'#9d174d' },
  { id:'UNKNOWN',  label:'Unidentified account', kind:'bank',   color:'#6b7280' },
];

export const instLabel = id =>
  (INSTITUTIONS.find(i => i.id === id) || INSTITUTIONS.at(-1)).label;
export const instColor = id =>
  (INSTITUTIONS.find(i => i.id === id) || INSTITUTIONS.at(-1)).color;
export const instKind = id =>
  (INSTITUTIONS.find(i => i.id === id) || INSTITUTIONS.at(-1)).kind;

// ── Fingerprints ──────────────────────────────────────────────────────────────
/**
 * Detection reads the STRUCTURE of the file, not its contents.
 *
 * Scanning the whole text for a bank name is unreliable in the obvious way: a
 * BMO statement containing "INTERAC ETRNSFR ... CANADIAN TIRE BANK" was being
 * identified as a Canadian Tire statement, and a PC Mastercard file with a
 * "Payment BMO" line was read as BMO. Column headings do not lie in that way.
 */
const HEADER_SIGNATURES = [
  { id:'BMO',      test: h => h.includes('first bank card') },
  { id:'BMO',      test: h => h.includes('in / out') && h.includes('item') },
  { id:'PC_MC',    test: h => h.includes('card holder name') },
  { id:'CTFS',     test: h => h.includes('ref') && h.includes('posted date') },
  { id:'WS_PERS',  test: h => h.includes('net_cash_amount') },
  { id:'CIBC',     test: h => h.includes('description 1') },
  { id:'CIBC',     test: h => h.includes('activity type') },
];

// Only the preamble is safe to read for a bank name — transaction rows mention
// other institutions constantly.
const PREAMBLE_MARKERS = [
  { id:'CIBC',     re:/cibc/i },
  { id:'CTFS',     re:/canadian tire|triangle|ctfs/i },
  { id:'PC_MC',    re:/pc financial|president'?s choice|pc mastercard/i },
  { id:'WS_PERS',  re:/wealthsimple/i },
  { id:'BMO',      re:/bank of montreal|\bbmo\b/i },
];

const normHeader = s => String(s || '')
  .replace(/^\uFEFF/, '').replace(/['"]/g, '').toLowerCase()
  .replace(/[^a-z0-9_ /]/g, '').trim();

/**
 * Instant, offline detection. Returns { id, confidence, how }.
 */
export function fingerprintBank(text) {
  const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // Find the heading row, then match on its column names
  for (let i = 0; i < Math.min(25, lines.length); i++) {
    const cells = lines[i].split(',').map(normHeader);
    const hasDate = cells.some(c => c.includes('date'));
    const hasAmt  = cells.some(c => c.includes('amount') || c.includes('cash'));
    if (!hasDate || !hasAmt) continue;

    for (const sig of HEADER_SIGNATURES) {
      if (sig.test(cells)) {
        return { id: sig.id, confidence:'high',
                 how: 'Matched the column layout of a ' + sig.id + ' export' };
      }
    }
    break;   // heading row found but unrecognised — stop looking
  }

  // Fall back to the preamble above the heading row only
  const preamble = lines.slice(0, 4).join(' ');
  for (const m of PREAMBLE_MARKERS) {
    if (m.re.test(preamble)) {
      return { id: m.id, confidence:'medium', how:'Named in the statement header' };
    }
  }

  return { id: 'UNKNOWN', confidence: 'none', how: null };
}

/**
 * Ask Claude to identify the institution when fingerprints come up empty.
 * Cheap — we only send the first chunk of the file.
 */
export async function aiIdentifyBank(text) {
  const ids = INSTITUTIONS.filter(i => i.id !== 'UNKNOWN').map(i => i.id);
  try {
    const data = await callClaude({
      model: MODEL_FAST, max_tokens: 200,
      messages:[{ role:'user', content:
        `This is the beginning of a Canadian bank or credit card statement.\n` +
        `Identify which institution it is from. Valid ids: ${ids.join(', ')}\n\n` +
        `--- STATEMENT ---\n${(text||'').slice(0,3000)}\n--- END ---\n\n` +
        `Reply ONLY with JSON, no markdown:\n` +
        `{"id":"<one id, or UNKNOWN>","confidence":"high|medium|none",` +
        `"how":"<short reason>"}` }],
    });
    const out = JSON.parse(textOf(data));
    if (!ids.includes(out.id)) return { id:'UNKNOWN', confidence:'none', how:null };
    return out;
  } catch {
    return { id:'UNKNOWN', confidence:'none', how:null };
  }
}

/**
 * Full detection chain for a text-readable file.
 * Returns { id, confidence, how }
 */
export async function detectBank(text) {
  const fp = fingerprintBank(text);
  if (fp.confidence === 'high') return fp;
  return await aiIdentifyBank(text);
}
