/**
 * Bank statement CSV parser — BMO, CTFS, WS Joint, PC Mastercard, CIBC
 * Handles multiple date formats and column layouts.
 */

import { categorize } from './categorize.js';

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ── Date parser — handles every format we've seen ─────────────────────────────
const MONTH_IDX = {
  jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11,
  january:0,february:1,march:2,april:3,may_:4,june:5,july:6,august:7,
  september:8,october:9,november:10,december:11,
};

export function parseDate(raw) {
  if (!raw) return null;
  const s = String(raw).replace(/['"]/g, '').trim();

  // ISO: 2026-07-03  or  2026-07-03T...
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s.slice(0, 10) + 'T00:00:00');
    return isNaN(d) ? null : d;
  }

  // MM/DD/YYYY  or  DD/MM/YYYY — assume North American (MM/DD) unless day > 12
  const slash = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (slash) {
    const [, a, b, y] = slash.map(Number);
    // if first part > 12 it must be day (DD/MM)
    const [mo, dy] = a > 12 ? [b - 1, a] : [a - 1, b];
    const d = new Date(y, mo, dy);
    return isNaN(d) ? null : d;
  }

  // Jul. 03/2026 or Jul 3, 2026 (CIBC / TD style)
  const mon = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})[,\/\s]+(\d{4})/);
  if (mon) {
    const key = mon[1].toLowerCase().replace(/[^a-z]/g, '');
    const mo = MONTH_IDX[key] ?? MONTH_IDX[key + '_'];
    if (mo !== undefined) {
      const d = new Date(parseInt(mon[3]), mo, parseInt(mon[2]));
      return isNaN(d) ? null : d;
    }
  }

  // Last resort — try native Date parse
  const fallback = new Date(s);
  return isNaN(fallback) ? null : fallback;
}

// ── CSV row splitter — handles quoted commas ──────────────────────────────────
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

// ── Normalise a header cell ───────────────────────────────────────────────────
const normH = s => s.replace(/['"]/g, '').toLowerCase().replace(/[^a-z0-9_ ]/g, '').trim();

// ── Detect bank from header row ───────────────────────────────────────────────
function detectFormat(headers) {
  const h = headers.map(normH);
  if (h.some(c => c === 'activity type' || c === 'activity_type')) return 'CIBC';
  if (h.some(c => c === 'description 1' || c === 'description1'))   return 'CIBC';
  if (h.some(c => c === 'transaction_date' || c.includes('net_cash'))) return 'WS_CTFS';
  if (h.some(c => c === 'cad' || c.startsWith('cad')))               return 'BMO_PC';
  if (h.some(c => c === 'debit' || c === 'credit'))                   return 'CIBC_ALT';
  return 'GENERIC';
}

// ── Strip a dollar amount string → number ─────────────────────────────────────
const parseAmt = s => parseFloat(String(s).replace(/['"$,+\s]/g, ''));

// ── Main parser ───────────────────────────────────────────────────────────────
export function parseStatementCSV(text, source) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return { rows: [], error: 'File appears empty.' };

  // Find header row (scan first 20 lines)
  let headerIdx = -1, rawHeaders = [], normHeaders = [];
  for (let i = 0; i < Math.min(20, lines.length); i++) {
    const raw = splitCSV(lines[i]);
    const norm = raw.map(normH);
    const hasDate = norm.some(c => c.includes('date'));
    const hasAmt  = norm.some(c =>
      c.includes('amount') || c === 'cad' || c.startsWith('cad') ||
      c.includes('cash') || c === 'debit' || c === 'credit'
    );
    if (hasDate && hasAmt) {
      headerIdx = i; rawHeaders = raw; normHeaders = norm; break;
    }
  }

  if (headerIdx < 0) {
    // Show first few lines as debug info
    const preview = lines.slice(0, 5).join(' | ');
    return { rows: [], error: `Could not find column headers. First lines: "${preview}"` };
  }

  const fmt = detectFormat(rawHeaders);
  const rows = [];
  let skipped = 0;

  // ── Column indices ──────────────────────────────────────────────────────────
  const col = name => normHeaders.findIndex(h => h === name || h.includes(name));

  const dateIdx = (() => {
    const i = normHeaders.findIndex(h =>
      h === 'transaction date' || h === 'transaction_date' ||
      h === 'date posted' || h === 'posted date' || h === 'date'
    );
    return i >= 0 ? i : 0;
  })();

  // CIBC has two description columns
  const isCIBC = fmt === 'CIBC' || fmt === 'CIBC_ALT';
  const desc1Idx = isCIBC
    ? normHeaders.findIndex(h => h === 'description 1' || h === 'description1' || h === 'description')
    : normHeaders.findIndex(h => h.includes('description') || h.includes('desc') ||
        (h.includes('name') && !h.includes('account') && !h.includes('currency')));
  const desc2Idx = isCIBC
    ? normHeaders.findIndex(h => h === 'description 2' || h === 'description2')
    : -1;

  // Amount: prefer net_cash_amount (WS/CTFS), then cad (BMO/CIBC), then amount, then debit
  const amtIdx = (() => {
    for (const name of ['net_cash_amount','cad','amount']) {
      const i = normHeaders.findIndex(h => h === name || (name !== 'cad' && h.includes(name)));
      if (i >= 0) return i;
    }
    // CIBC alt: separate debit/credit columns
    const dIdx = normHeaders.findIndex(h => h === 'debit' || h === 'withdrawal');
    return dIdx >= 0 ? dIdx : -1;
  })();

  // CIBC alt credit column (to skip income rows)
  const creditIdx = fmt === 'CIBC_ALT'
    ? normHeaders.findIndex(h => h === 'credit' || h === 'deposit')
    : -1;

  // Activity type col (CIBC — skip Credits that are income)
  const actIdx = normHeaders.findIndex(h => h === 'activity type' || h === 'activity_type');

  if (dateIdx < 0 || desc1Idx < 0 || amtIdx < 0) {
    return {
      rows: [],
      error: `Could not map columns. Headers found: [${normHeaders.join(', ')}]. ` +
             `Needed: date (idx ${dateIdx}), description (idx ${desc1Idx}), amount (idx ${amtIdx}).`
    };
  }

  // ── Parse rows ──────────────────────────────────────────────────────────────
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = splitCSV(lines[i]);
    if (cols.length < 3) continue;

    const dateRaw = cols[dateIdx]?.replace(/['"]/g, '').trim();
    const dateObj  = parseDate(dateRaw);
    if (!dateObj) { skipped++; continue; }

    // Build description: combine desc1 + desc2 (CIBC)
    const d1 = cols[desc1Idx]?.replace(/['"]/g, '').trim() || '';
    const d2 = desc2Idx >= 0 ? (cols[desc2Idx]?.replace(/['"]/g, '').trim() || '') : '';
    const desc = [d1, d2].filter(Boolean).join(' — ').trim();
    if (!desc) { skipped++; continue; }

    // Skip income/credit rows for CIBC
    if (actIdx >= 0) {
      const act = (cols[actIdx] || '').toLowerCase();
      if (act === 'credit' || act === 'interest' || act === 'transfer in') {
        // Still run through categoriser — it will _skip income rows
      }
    }

    // For CIBC alt (separate debit/credit cols): use debit col, skip if empty (= credit)
    
    if (fmt === 'CIBC_ALT' && creditIdx >= 0) {
      const debitStr = cols[amtIdx]?.replace(/['"$,+\s]/g, '').trim();
      if (!debitStr || debitStr === '' || debitStr === '0') { skipped++; continue; }
      amount = parseFloat(debitStr);
    } else {
      amount = parseAmt(cols[amtIdx] || '0');
    }

    if (isNaN(amount) || Math.abs(amount) < 0.50) { skipped++; continue; }
    amount = Math.abs(amount);

    const cat = categorize(desc);
    if (cat === '_skip') { skipped++; continue; }

    rows.push({
      id:          uid(),
      date:        dateObj.toISOString().slice(0, 10),
      description: desc,
      amount,
      category:    cat,
      source,
      month:       dateObj.getMonth(),
      year:        dateObj.getFullYear(),
    });
  }

  return { rows, skipped, debug: { format: fmt, headers: normHeaders, headerIdx } };
}
