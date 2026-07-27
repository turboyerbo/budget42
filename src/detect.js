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
// Ordered most-specific first. Each is a set of markers; all `all` must appear.
const FINGERPRINTS = [
  { id:'CIBC',     all:[/cibc/i] },
  { id:'CIBC',     all:[/description 1/i, /description 2/i] },
  { id:'CTFS',     all:[/canadian tire|triangle|ctfs/i] },
  { id:'PC_MC',    all:[/pc financial|president'?s choice|pc mastercard|pcf/i] },
  { id:'WS_JOINT', all:[/wealthsimple/i, /joint/i] },
  { id:'WS_PERS',  all:[/wealthsimple/i] },
  { id:'WS_PERS',  all:[/net_cash_amount|transaction_date/i] },
  { id:'BMO',      all:[/bank of montreal|bmo/i] },
  { id:'BMO',      all:[/first bank card/i] },
];

/**
 * Fast, offline detection from raw file text (CSV text, or text pulled
 * from a PDF). Returns { id, confidence } — confidence 'high' | 'none'.
 */
export function fingerprintBank(text) {
  const sample = (text || '').slice(0, 4000);
  for (const fp of FINGERPRINTS) {
    if (fp.all.every(re => re.test(sample))) {
      return { id: fp.id, confidence: 'high', how: 'Recognised from the statement text' };
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
