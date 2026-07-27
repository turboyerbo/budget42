/**
 * Bank statement CSV parser — BMO, CTFS, WS, PC Mastercard, CIBC
 *
 * BUG FIX: previous version had `let amount: number` (TypeScript syntax in JS)
 * which stripped the declaration, leaving `amount` undeclared at runtime.
 * Rewritten so `amount` is always a const computed inline.
 */
import { categorize } from './categorize.js';

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const MONTH_IDX = {
  jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,
};

export function parseDate(raw) {
  if (!raw) return null;
  const s = String(raw).replace(/['"]/g, '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s.slice(0,10) + 'T00:00:00');
    return isNaN(d) ? null : d;
  }
  const slash = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (slash) {
    const [,a,b,y] = slash.map(Number);
    const [mo,dy] = a > 12 ? [b-1,a] : [a-1,b];
    const d = new Date(y,mo,dy);
    return isNaN(d) ? null : d;
  }
  const mon = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})[,\/\s]+(\d{4})/);
  if (mon) {
    const mo = MONTH_IDX[mon[1].toLowerCase().slice(0,3)];
    if (mo !== undefined) {
      const d = new Date(parseInt(mon[3]), mo, parseInt(mon[2]));
      return isNaN(d) ? null : d;
    }
  }
  const fallback = new Date(s);
  return isNaN(fallback) ? null : fallback;
}

export function splitCSV(line) {
  const cols = []; let cur = ''; let inQ = false;
  for (const ch of line) {
    if (ch === '"') inQ = !inQ;
    else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
    else cur += ch;
  }
  cols.push(cur.trim());
  return cols;
}

const normH = s => s.replace(/['"]/g,'').toLowerCase().replace(/[^a-z0-9_ ]/g,'').trim();

const parseAmt = s => {
  const n = parseFloat(String(s || '0').replace(/['"$,+\s]/g,''));
  return isNaN(n) ? 0 : n;
};

function detectFormat(headers) {
  const h = headers.map(normH);
  if (h.some(c => c === 'activity type' || c === 'activity_type')) return 'CIBC';
  if (h.some(c => c === 'description 1' || c === 'description1'))   return 'CIBC';
  if (h.some(c => c.includes('net_cash') || c === 'transaction_date')) return 'WS_CTFS';
  if (h.some(c => c === 'cad' || c.startsWith('cad')))               return 'BMO_PC';
  if (h.some(c => c === 'debit' || c === 'credit'))                   return 'CIBC_ALT';
  return 'GENERIC';
}

export function parseStatementCSV(text, source = 'UNKNOWN') {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return { rows:[], error:'File appears empty.' };

  // Find header row
  let headerIdx = -1, normHeaders = [];
  for (let i = 0; i < Math.min(20, lines.length); i++) {
    const norm = splitCSV(lines[i]).map(normH);
    const hasDate = norm.some(c => c.includes('date'));
    const hasAmt  = norm.some(c =>
      c === 'cad' || c.startsWith('cad') ||
      c.includes('amount') || c.includes('cash') ||
      c === 'debit' || c === 'credit'
    );
    if (hasDate && hasAmt) { headerIdx = i; normHeaders = norm; break; }
  }

  if (headerIdx < 0) {
    const preview = lines.slice(0,5).map(l => l.slice(0,60)).join(' | ');
    return { rows:[], error:`Could not find column headers.\nFirst lines: "${preview}"\n\nMake sure you exported a CSV (not XLSX) from your bank.` };
  }

  const fmt = detectFormat(splitCSV(lines[headerIdx]));

  const dateIdx = normHeaders.findIndex(c =>
    c === 'transaction date' || c === 'transaction_date' ||
    c === 'date posted'      || c === 'posted date'      || c === 'date'
  );
  const desc1Idx = (fmt === 'CIBC' || fmt === 'CIBC_ALT')
    ? normHeaders.findIndex(c => c === 'description 1' || c === 'description1' || c === 'description')
    : normHeaders.findIndex(c =>
        c === 'description' || c.includes('description') || c.includes('desc') ||
        (c.includes('name') && !c.includes('account') && !c.includes('currency'))
      );
  const desc2Idx = (fmt === 'CIBC' || fmt === 'CIBC_ALT')
    ? normHeaders.findIndex(c => c === 'description 2' || c === 'description2')
    : -1;
  const amtIdx = (() => {
    for (const n of ['net_cash_amount','cad','amount']) {
      const i = normHeaders.findIndex(c => c === n || (n !== 'cad' && c.includes(n)));
      if (i >= 0) return i;
    }
    const i = normHeaders.findIndex(c => c === 'debit' || c === 'withdrawal');
    return i >= 0 ? i : normHeaders.findIndex(c => c.startsWith('cad'));
  })();
  const creditIdx = (fmt === 'CIBC_ALT')
    ? normHeaders.findIndex(c => c === 'credit' || c === 'deposit')
    : -1;

  if (dateIdx < 0 || desc1Idx < 0 || amtIdx < 0) {
    return {
      rows:[], error:
        `Could not map columns.\nHeaders found: [${normHeaders.join(', ')}]\n` +
        `date col: ${dateIdx}, desc col: ${desc1Idx}, amount col: ${amtIdx}\n\n` +
        `Supported banks: BMO, CTFS, Wealthsimple, PC Mastercard, CIBC.`
    };
  }

  const rows = []; let skipped = 0;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = splitCSV(lines[i]);
    if (cols.length < 3) continue;

    const dateObj = parseDate(cols[dateIdx]);
    if (!dateObj) { skipped++; continue; }

    const d1 = (cols[desc1Idx] || '').replace(/['"]/g,'').trim();
    const d2 = desc2Idx >= 0 ? (cols[desc2Idx] || '').replace(/['"]/g,'').trim() : '';
    const desc = [d1, d2].filter(Boolean).join(' — ').trim();
    if (!desc) { skipped++; continue; }

    // ── AMOUNT: always compute as a const — this was the crash bug ──────────
    // For CIBC_ALT (separate debit/credit columns): skip if debit cell is blank
    const rawAmt = (cols[amtIdx] || '').replace(/['"$,+\s]/g,'').trim();
    if (fmt === 'CIBC_ALT' && creditIdx >= 0 && (!rawAmt || rawAmt === '0')) {
      skipped++; continue;           // blank debit cell = it's a credit (income)
    }
    const amount = Math.abs(parseAmt(rawAmt));
    if (!amount || isNaN(amount) || amount < 0.50) { skipped++; continue; }

    const cat = categorize(desc);
    if (cat === '_skip') { skipped++; continue; }

    rows.push({
      id:          uid(),
      date:        dateObj.toISOString().slice(0,10),
      description: desc,
      amount,
      category:    cat,
      source,
      month:       dateObj.getMonth(),
      year:        dateObj.getFullYear(),
    });
  }

  return { rows, skipped, debug:{ format:fmt, headers:normHeaders, headerIdx } };
}
