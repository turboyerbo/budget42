/**
 * Bank statement CSV parser.
 *
 * Written against real exports from BMO, CTFS, Wealthsimple, PC Mastercard and
 * CIBC. Two things vary more than you would expect between banks, and guessing
 * at either produces silently wrong numbers:
 *
 *   DATES  — BMO writes 20260102 with no separators, which `new Date()` reads
 *            as Invalid Date. CTFS and Wealthsimple use ISO. PC uses MM/DD/YYYY.
 *
 *   SIGNS  — on a chequing statement a purchase is negative. On a Canadian Tire
 *            credit card statement a purchase is POSITIVE and a payment is
 *            negative. Reading CTFS with chequing rules files every purchase as
 *            income. Where a statement has an explicit type column, that is
 *            trusted ahead of the sign.
 */
import { categorize, categorizeBudget } from './categorize.js';

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

const MONTH_IDX = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };

// ── Dates ─────────────────────────────────────────────────────────────────────
export function parseDate(raw) {
  if (!raw) return null;
  const s = String(raw).replace(/['"]/g, '').trim();

  // ISO: 2026-04-12
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
    const d = new Date(s.slice(0, 10) + 'T00:00:00');
    return isNaN(d) ? null : d;
  }

  // BMO compact: 20260102. Note new Date('20260102') is Invalid Date, so this
  // must be split by hand. Missing this silently discarded every BMO row.
  const compact = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (compact) {
    const d = new Date(+compact[1], +compact[2] - 1, +compact[3]);
    return isNaN(d) ? null : d;
  }

  // 04/30/2026 or 30-04-2026
  const slash = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (slash) {
    const [, a, b, y] = slash.map(Number);
    const [mo, dy] = a > 12 ? [b - 1, a] : [a - 1, b];
    const d = new Date(y, mo, dy);
    return isNaN(d) ? null : d;
  }

  // Jul. 03/2026  ·  July 3, 2026
  const mon = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2})[,\/\s]+(\d{4})/);
  if (mon) {
    const mo = MONTH_IDX[mon[1].toLowerCase().slice(0, 3)];
    if (mo !== undefined) {
      const d = new Date(+mon[3], mo, +mon[2]);
      return isNaN(d) ? null : d;
    }
  }

  const fallback = new Date(s);
  return isNaN(fallback) ? null : fallback;
}

// ── CSV splitting ─────────────────────────────────────────────────────────────
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

const normH = s => String(s || '')
  .replace(/^\uFEFF/, '')            // byte order mark on BMO exports
  .replace(/['"]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9_ /]/g, '')
  .trim();

const parseAmt = s => {
  const n = parseFloat(String(s ?? '').replace(/['"$,+\s]/g, ''));
  return isNaN(n) ? NaN : n;
};

// ── Format profiles ───────────────────────────────────────────────────────────
/**
 * `cardPositive` marks statements where a PURCHASE is written as a positive
 * number, which is the credit-card convention on CTFS.
 */
const FORMATS = [
  {
    id: 'BMO_CLASSIC',
    match: h => h.includes('first bank card'),
    date: ['date posted'],
    desc: ['description'],
    amount: ['transaction amount'],
    typeCol: 'transaction type',       // DEBIT / CREDIT
    cardPositive: false,
  },
  {
    id: 'BMO_ENRICHED',
    match: h => h.includes('in / out') || (h.includes('item') && h.includes('source')),
    date: ['date'],
    desc: ['description'],
    amount: ['amount'],
    typeCol: 'in / out',               // DEBIT / CREDIT
    cardPositive: false,
  },
  {
    id: 'CTFS',
    match: h => h.includes('ref') && h.includes('posted date'),
    date: ['transaction date', 'posted date'],
    desc: ['description'],
    amount: ['amount'],
    typeCol: 'type',                   // PURCHASE / PAYMENT / REFUND
    cardPositive: true,                // purchases are positive here
  },
  {
    id: 'PC_MC',
    match: h => h.includes('card holder name'),
    date: ['date'],
    desc: ['description'],
    amount: ['amount'],
    typeCol: 'type',                   // PURCHASE / PAYMENT / REFUND
    cardPositive: false,
  },
  {
    id: 'WEALTHSIMPLE',
    match: h => h.includes('net_cash_amount'),
    // Newer exports call it effective_date; older ones transaction_date.
    date: ['effective_date', 'transaction_date'],
    // Monthly exports have no description column at all; the sub-type carries
    // the meaning (SPEND, E_TRFIN, E_TRFOUT, Interest).
    desc: ['description', 'activity_sub_type', 'activity_type'],
    amount: ['net_cash_amount'],
    typeCol: null,
    cardPositive: false,
    accountCol: 'account_id',
    // Buying and selling investments moves money between cash and holdings. It is
    // not spending (or income), so those rows are left out of the import.
    skipCol: 'activity_type',
    skipValues: /^trade$/i,
  },
  {
    id: 'CIBC',
    match: h => h.includes('description 1') || h.includes('activity type'),
    date: ['date', 'transaction date'],
    desc: ['description 1', 'description'],
    amount: ['amount', 'debit'],
    creditCol: 'credit',
    typeCol: null,
    cardPositive: false,
  },
];

const GENERIC = {
  id: 'GENERIC',
  date: ['transaction date', 'date posted', 'posted date', 'transaction_date', 'date'],
  desc: ['description', 'description 1', 'details', 'memo', 'payee'],
  amount: ['amount', 'net_cash_amount', 'transaction amount', 'debit'],
  creditCol: 'credit',
  typeCol: null,
  cardPositive: false,
};

const findCol = (headers, names) => {
  for (const n of names) {
    const exact = headers.indexOf(n);
    if (exact >= 0) return exact;
  }
  for (const n of names) {
    const loose = headers.findIndex(h => h.includes(n));
    if (loose >= 0) return loose;
  }
  return -1;
};

// Known Wealthsimple accounts, so rows land on the right card
const WS_ACCOUNTS = {
  WK63L5732CAD: 'WS_JOINT',
  WK5YMCW31CAD: 'WS_PERS',
};

/** DEBIT / CREDIT from an explicit type column, when the statement has one. */
function directionFromType(value) {
  const v = String(value || '').toLowerCase();
  if (!v) return null;
  if (/purchase|debit|withdrawal|fee|interest charge|out\b/.test(v)) return 'debit';
  if (/payment|credit|refund|deposit|rebate|in\b/.test(v))          return 'credit';
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────
export function parseStatementCSV(text, source = 'UNKNOWN') {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map(l => l.replace(/^\uFEFF/, '').trim())
    .filter(Boolean);

  if (lines.length < 2) return { rows: [], error: 'That file looks empty.' };

  // Find the header row. Banks pad the top with preamble and blank lines.
  let headerIdx = -1, headers = [];
  for (let i = 0; i < Math.min(25, lines.length); i++) {
    const h = splitCSV(lines[i]).map(normH);
    const hasDate = h.some(c => c.includes('date'));
    const hasAmt  = h.some(c =>
      c.includes('amount') || c.includes('cash') || c === 'debit' || c === 'credit');
    // Skip summary rows like "Start Date,End Date,Current Balance"
    const looksLikeSummary = h.includes('current balance') || h.includes('available credit');
    if (hasDate && hasAmt && !looksLikeSummary) { headerIdx = i; headers = h; break; }
  }

  if (headerIdx < 0) {
    return { rows: [], error:
      'Could not find the column headings.\nFirst lines: "' +
      lines.slice(0, 3).map(l => l.slice(0, 50)).join(' | ') +
      '"\n\nMake sure this is a CSV export rather than a spreadsheet or PDF.' };
  }

  const fmt = FORMATS.find(f => f.match(headers)) || GENERIC;

  const dateIdx = findCol(headers, fmt.date);
  const descIdx = findCol(headers, fmt.desc);
  const amtIdx  = findCol(headers, fmt.amount);
  const typeIdx = fmt.typeCol    ? findCol(headers, [fmt.typeCol])    : -1;
  const credIdx = fmt.creditCol  ? findCol(headers, [fmt.creditCol])  : -1;
  const acctIdx = fmt.accountCol ? findCol(headers, [fmt.accountCol]) : -1;
  const skipIdx = fmt.skipCol    ? findCol(headers, [fmt.skipCol])    : -1;

  if (dateIdx < 0 || amtIdx < 0) {
    return { rows: [], error:
      `Recognised the layout as ${fmt.id}, but could not find the ` +
      `${dateIdx < 0 ? 'date' : 'amount'} column.\nHeadings found: ${headers.join(', ')}` };
  }

  const rows = [];
  let skipped = 0;
  const reasons = { date: 0, amount: 0, blank: 0, investment: 0 };

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const cols = splitCSV(lines[i]);
    if (cols.length < 2) { skipped++; reasons.blank++; continue; }

    if (skipIdx >= 0 && fmt.skipValues.test((cols[skipIdx] || '').trim())) {
      skipped++; reasons.investment++; continue;
    }

    const dateObj = parseDate(cols[dateIdx]);
    if (!dateObj) { skipped++; reasons.date++; continue; }

    // Description: fall back through the profile's list, then to the type column
    let desc = '';
    if (descIdx >= 0) desc = (cols[descIdx] || '').replace(/['"]/g, '').trim();
    if (!desc && typeIdx >= 0) desc = (cols[typeIdx] || '').trim();
    if (!desc) desc = '(no description)';
    desc = desc.replace(/\s{2,}/g, ' ').trim();

    // Amount, keeping the sign for now
    let signed = parseAmt(cols[amtIdx]);
    let fromCreditCol = false;
    if ((isNaN(signed) || signed === 0) && credIdx >= 0) {
      const c = parseAmt(cols[credIdx]);
      if (!isNaN(c) && c !== 0) { signed = c; fromCreditCol = true; }
    }
    if (isNaN(signed) || signed === 0) { skipped++; reasons.amount++; continue; }

    const amount = Math.abs(signed);
    if (amount < 0.01) { skipped++; reasons.amount++; continue; }

    // Direction: explicit column wins, then sign, adjusted for card conventions
    let direction = typeIdx >= 0 ? directionFromType(cols[typeIdx]) : null;
    if (!direction) {
      if (fromCreditCol) direction = 'credit';
      else if (fmt.cardPositive) direction = signed > 0 ? 'debit' : 'credit';
      else direction = signed < 0 ? 'debit' : 'credit';
    }

    // Wealthsimple files can hold several accounts at once
    let rowSource = source;
    if (acctIdx >= 0) {
      const acct = (cols[acctIdx] || '').replace(/['"]/g, '').trim();
      if (WS_ACCOUNTS[acct]) rowSource = WS_ACCOUNTS[acct];
    }

    // Budget rules first, then the older merchant list
    const cat = categorizeBudget(desc) || categorize(desc);

    // Paying your own credit card from chequing shows up as an ordinary debit,
    // so the credit-only rule missed it and counted it as spending. Naming the
    // card issuers catches it from either side.
    const CARD_PAYEE = /canadian tire bank|\bctfs\b|pc mc\b|pc mastercard|president'?s choice|capital one|amex|american express|mbna|rogers bank|neo financial|home trust/i;
    const isCardPayment =
      (direction === 'credit' && /payment|pmt|paiement|thank you|autopay|pre.?auth/i.test(desc)) ||
      CARD_PAYEE.test(desc);

    // Wealthsimple writes movements between your own accounts as bare codes.
    // These are not spending and must not be mistaken for bills.
    const TRANSFER_CODE = /^(e_trf(in|out)|transfer_tf|aft_(in|out)|eft|withdrawal|deposit|buy|sell)$/i;
    const isTransfer =
      TRANSFER_CODE.test(desc.trim()) ||
      /money transfer (in|out)|interac e-?transfer.*(in|out)$/i.test(desc) ||
      /^\[cw\]\s*tf\b|^\[ck\]no\.|returned item/i.test(desc) ||
      // BMO e-transfers (SENT / FULFILL / AD RECVD) move money between people or
      // accounts. A specific rule such as rent to the landlord has already
      // claimed its own e-transfers, so only the unclaimed ones count as transfers.
      (cat === '_skip' && /interac etrnsfr/i.test(desc));

    // Money arriving is income unless it is a card payment or an internal
    // move. Without this, every paycheque and refund sat in "Other".
    const isIncome = direction === 'credit' && !isCardPayment && !isTransfer;

    rows.push({
      id:          uid(),
      date:        dateObj.toISOString().slice(0, 10),
      description: desc,
      amount,
      category:    isCardPayment ? 'cc_payment'
                 : isTransfer    ? 'transfer'
                 : isIncome      ? 'income'
                 : (cat === '_skip' ? 'other' : cat),
      source:      rowSource,
      month:       dateObj.getMonth(),
      year:        dateObj.getFullYear(),
      _type:       direction,
      _internal:   cat === '_skip',
    });
  }

  if (rows.length === 0) {
    return { rows: [], skipped, debug: { format: fmt.id, headers, headerIdx, reasons },
      error:
        `Recognised the layout as ${fmt.id} and found ${skipped} rows, but none could ` +
        `be read.\n` +
        `Unreadable dates: ${reasons.date} · unreadable amounts: ${reasons.amount}` +
        (reasons.investment ? ` · investment trades left out: ${reasons.investment}` : '') + `\n` +
        `Date column: "${headers[dateIdx]}" · first value: "${splitCSV(lines[headerIdx+1] || '')[dateIdx] || ''}"` };
  }

  return { rows, skipped, debug: { format: fmt.id, headers, headerIdx, reasons } };
}
