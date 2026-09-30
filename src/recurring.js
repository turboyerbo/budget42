/**
 * Work out which charges recur, from the statements themselves.
 *
 * The old model kept two hardcoded lists (rent, insurance, subscriptions) and
 * added their total to every month as "committed". That double counted: those
 * same charges arrive in the imported statements too, so they were already
 * inside "spent". Rent was subtracted twice.
 *
 * The honest question is not "what do I owe each month" but "what is still to
 * come this month". A bill already paid is spending. A bill not yet charged is
 * a commitment. Only the second belongs in the committed figure.
 */
import { merchantKey, bestLabel } from './merchant.js';

// Prefer the year/month columns (set at insert time), but fall back to
// parsing the date string itself — belt and suspenders, since a month spent
// grouped under "undefined-undefined" silently breaks recurring detection.
const monthKey = t => {
  if (t.year != null && t.month != null) return `${t.year}-${t.month}`;
  const m = /^(\d{4})-(\d{2})/.exec(String(t.date || ''));
  return m ? `${m[1]}-${parseInt(m[2], 10) - 1}` : 'unknown';
};
const dayOf    = d => parseInt(String(d).slice(8, 10), 10) || 1;
const median   = ns => {
  const s = [...ns].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

/**
 * A merchant is recurring if it appears in at least `minMonths` different
 * months with a roughly stable amount.
 *
 * Returns [{ key, label, amount, category, day, monthsSeen, varies }]
 */
export function detectRecurring(imports, { minMonths = 2, tolerance = 0.3 } = {}) {
  const groups = new Map();

  imports.forEach(t => {
    // Money in and money moved between accounts are not bills
    if (t.direction === 'credit' || t._type === 'credit') return;
    if (['income', 'cc_payment', 'transfer'].includes(t.category)) return;

    const key = merchantKey(t.description || '');
    if (!key || key.length < 3) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  });

  const out = [];

  groups.forEach((rows, key) => {
    const months = new Set(rows.map(monthKey));
    if (months.size < minMonths) return;

    // One charge per month is the shape of a bill. Several charges a month at
    // the same shop is a habit, so require roughly one per month.
    if (rows.length > months.size * 2.5) return;

    const amounts = rows.map(r => r.amount);
    const typical = median(amounts);
    if (!typical || typical < 0.5) return;

    // Thresholds chosen by looking at real statements. Bills sit at low spread
    // and roughly one charge a month; transfers between accounts run five to
    // twelve a month with spreads of 300% or more.
    const spread = (Math.max(...amounts) - Math.min(...amounts)) / typical;

    const days  = rows.map(r => dayOf(r.date)).sort((a, b) => a - b);
    const drift = days[days.length - 1] - days[0];
    const wrapsMonthEnd = days[0] <= 3 && days[days.length - 1] >= 27;

    // An amount that barely moves is strong evidence on its own. Rent paid by
    // e-transfer lands anywhere from the 5th to the 31st but is always the same
    // figure, and that is unmistakably a bill.
    const steadyAmount = spread <= 0.15;

    const amountOk = spread <= 1.0;
    const dateOk   = drift <= 20 || wrapsMonthEnd;

    if (!steadyAmount && !(amountOk && dateOk)) return;

    // Confidence, rather than a hard yes/no. A shop visited about once a month
    // looks a lot like a subscription on paper; the difference is that a bill
    // charges nearly the same amount on nearly the same day. Anything less
    // certain is offered to the user as a suggestion instead of being counted.
    const tightDate   = drift <= 12 || wrapsMonthEnd;
    const tightAmount = spread <= 0.3;
    // An identical figure three months running is a bill even if the date
    // wanders — rent paid by e-transfer lands whenever it lands.
    const identical = spread <= 0.02 && months.size >= 3;
    const confidence  =
      identical                                          ? 'high'
      : (steadyAmount && rows.length <= months.size * 1.5) ? 'high'
      : (tightAmount && tightDate)                        ? 'high'
      : 'low';

    out.push({
      key,
      label:      bestLabel(rows.map(r => r.description)),
      amount:     Math.round(typical * 100) / 100,
      category:   rows[rows.length - 1].category || 'other',
      source:     rows[rows.length - 1].source,
      day:        days[Math.floor(days.length / 2)],
      monthsSeen: months.size,
      varies:     Math.max(...amounts) - Math.min(...amounts) > typical * 0.1,
      lastSeen:   rows.map(r => r.date).sort().at(-1),
      confidence,
      spread:     Math.round(spread * 100) / 100,
      drift,
    });
  });

  return out.sort((a, b) => b.amount - a.amount);
}

// ── Matching bills to transactions ───────────────────────────────────────────
/** The text a transaction is matched on. Statement rows carry `description`;
 *  rows added by hand carry `note`/`merchant` instead. */
const txnText  = t => t.description || t.note || t.merchant || '';
const isCredit = t => (t.direction ?? t._type ?? 'debit') === 'credit';

/**
 * Every merchant key a bill answers to: its own key (a detected bill's key IS
 * the merchant key) plus its label normalised the same way (a hand-added
 * bill's key is "manual:<uid>", which never matches a statement on its own).
 */
export function billMatchKeys(bill) {
  const keys = new Set([bill.key]);
  if (bill.label) {
    const k = merchantKey(bill.label);
    if (k && k.length >= 3) keys.add(k);
  }
  return keys;
}

/**
 * THE one rule for "which of this month's transactions are bill payments".
 *
 * Before this existed, two different rules were in play: the bill tracker
 * decided a bill was paid by matching `description||note` against the bill's
 * key only, while Home and Charges decided which transactions to leave out of
 * everyday spending by matching `description||note||merchant` against the key
 * AND the label. A hand-added "Rent" bill therefore pulled the real rent
 * transaction out of Charges without ever marking the bill paid, so that money
 * vanished from both sides and Charges + Bills never added up.
 *
 * Returns:
 *   isBillTxn(t)  — true for every transaction that belongs to a bill (these
 *                   are counted under Bills, never under Charges)
 *   chargedByBill — bill key → total actually charged per the statements
 */
export function matchBillTransactions(recurring, monthTx) {
  const keyToBill = new Map();
  (recurring || []).forEach(r =>
    billMatchKeys(r).forEach(k => { if (!keyToBill.has(k)) keyToBill.set(k, r.key); }));

  const billTxnIds    = new Set();
  const billTxnObjs   = new Set();
  const chargedByBill = new Map();

  (monthTx || []).forEach(t => {
    // A bill ticked off by hand creates a stand-in transaction so the money
    // shows as spent before the statement arrives. It always belongs to Bills,
    // but it is NOT statement evidence, so it never locks the tick.
    if (t.source === 'bill-manual') {
      if (t.id != null) billTxnIds.add(t.id); else billTxnObjs.add(t);
      return;
    }
    if (isCredit(t)) return;                    // money in is never a bill payment
    const billKey = keyToBill.get(merchantKey(txnText(t)));
    if (!billKey) return;
    if (t.id != null) billTxnIds.add(t.id); else billTxnObjs.add(t);
    chargedByBill.set(billKey, (chargedByBill.get(billKey) || 0) + (Number(t.amount) || 0));
  });

  const isBillTxn = t => (t.id != null ? billTxnIds.has(t.id) : billTxnObjs.has(t));
  return { isBillTxn, chargedByBill };
}

const cents = n => Math.round(n * 100) / 100;

/**
 * Split recurring charges into those already seen this month and those still
 * expected. Only the latter is a commitment. A paid bill counts what was
 * actually charged, not the amount it usually is.
 */
export function splitRecurring(recurring, thisMonthTx) {
  const { chargedByBill } = matchBillTransactions(recurring, thisMonthTx);

  const paid = [], due = [];
  recurring.forEach(r => (chargedByBill.has(r.key) ? paid : due).push(r));

  return {
    paid,
    due,
    dueTotal:  due.reduce((a, r) => a + r.amount, 0),
    paidTotal: cents(paid.reduce((a, r) => a + chargedByBill.get(r.key), 0)),
  };
}

// ── Scheduling ────────────────────────────────────────────────────────────────
const DAY = 86400000;

/** Clamp a day-of-month to a real date (the 31st in a 30-day month, Feb 30). */
function safeDate(year, month, day) {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, lastDay));
}

/**
 * Turn recurring charges into a dated schedule for one month.
 *
 * Each entry gets a real calendar date, how many days away it is, and a status:
 *   paid    — already charged this month
 *   overdue — its usual day has passed and nothing has been charged
 *   due     — still expected
 *
 * `today` is injectable so this is testable rather than dependent on the clock.
 */
export function buildSchedule(recurring, thisMonthTx, year, month, today = new Date(),
                              manualPaid = []) {
  const { chargedByBill } = matchBillTransactions(recurring, thisMonthTx);

  // Ticked off by hand. Useful in the gap between paying a bill and the
  // statement arriving, which can be weeks.
  const manual = new Map(manualPaid.map(p => [p.key, p]));

  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const viewingCurrentMonth =
    year === today.getFullYear() && month === today.getMonth();

  const entries = recurring.map(r => {
    const date       = safeDate(year, month, r.day);
    const seenInData = chargedByBill.has(r.key);
    const tick       = manual.get(r.key);
    const daysAway   = Math.round((date - midnight) / DAY);

    let status = 'due';
    if (seenInData || tick) status = 'paid';
    else if (viewingCurrentMonth && daysAway < 0) status = 'overdue';

    // What this bill actually cost this month. Once the statement shows the
    // charge, that real figure wins over the usual amount — a $120 hydro bill
    // that came in at $134.27 is $134.27 of money out, and Charges has
    // already left that transaction out, so anything else would lose $14.27.
    const paidAmount = status !== 'paid' ? 0
                     : seenInData ? cents(chargedByBill.get(r.key))
                     : r.amount;

    return {
      ...r, date, daysAway, status, viewingCurrentMonth, paidAmount,
      seenInData,                       // a matching transaction exists
      tickedBy:  tick?.paid_by || null, // who ticked it, if anyone
      tickedAt:  tick?.paid_at || null,
      manualOnly: !!tick && !seenInData,
    };
  });

  // Soonest first, but anything overdue floats to the top
  entries.sort((a, b) => {
    const rank = s => (s === 'overdue' ? 0 : s === 'due' ? 1 : 2);
    if (rank(a.status) !== rank(b.status)) return rank(a.status) - rank(b.status);
    return a.date - b.date;
  });

  const outstanding = entries.filter(e => e.status !== 'paid');

  const outstandingTotal = cents(outstanding.reduce((a, e) => a + e.amount, 0));
  const paidTotal        = cents(entries.filter(e => e.status === 'paid').reduce((a, e) => a + e.paidAmount, 0));

  return {
    entries,
    outstanding,
    outstandingTotal,
    paidTotal,
    // Paid (at what it actually cost) + still to come (at the usual amount),
    // so "whole month" is always exactly "already paid" + "still to pay".
    monthTotal:       cents(paidTotal + outstandingTotal),
    // What is landing in the next week, which is the figure that decides
    // whether this week is tight
    dueThisWeek: outstanding.filter(e => e.daysAway >= 0 && e.daysAway <= 7),
    overdue:     entries.filter(e => e.status === 'overdue'),
  };
}

/** "in 3 days", "tomorrow", "today", "5 days ago" */
export function relativeDay(daysAway) {
  if (daysAway === 0)  return 'today';
  if (daysAway === 1)  return 'tomorrow';
  if (daysAway === -1) return 'yesterday';
  if (daysAway  <  0)  return `${Math.abs(daysAway)} days ago`;
  return `in ${daysAway} days`;
}

// ── User overrides ────────────────────────────────────────────────────────────
/**
 * Merge detected charges with the user's own edits.
 *
 * Detection is a starting point, not the last word. A rule can rename a bill,
 * correct its amount or day, confirm a suggestion, hide something that is not a
 * bill, or add one that never appears in a statement at all.
 */
/**
 * Merges auto-detected bills with the couple's own edits, then decides which
 * ones actually apply to the (year, month) being viewed — and with what
 * amount, since bill amounts genuinely change month to month (utilities,
 * variable subscriptions) and shouldn't silently rewrite history or the
 * future just because one month's charge was different.
 *
 * Whether a bill "exists" used to be entirely global: hiding it removed it
 * from every month at once, and its amount/label/day/category lived on a
 * single shared row, so editing a bill in ANY month changed it in EVERY
 * month. Now each month can be EXPLICITLY configured (activeOverrides /
 * configuredKeys) with its own amount, separate from every other month — but
 * a month that's never been touched falls back to the old always-show
 * behavior using the shared rule's values, so nothing changes for existing
 * bills until someone actually acts on a specific month.
 *
 * @param activeOverrides Map of "key|year|month" -> {amount,label,day,category}
 *                        (any field can be omitted to fall back to the rule's
 *                        value) — presence of the key means "active this month"
 * @param configuredKeys  Set of "year|month" strings — months set up at all
 */
export function applyBillRules(detected, rules = [], activeOverrides = new Map(), configuredKeys = new Set(), year = null, month = null) {
  const byKey = new Map(rules.map(r => [r.key, r]));
  const out = [];
  const monthTag = (year != null && month != null) ? `${year}|${month}` : null;
  const monthIsConfigured = monthTag != null && configuredKeys.has(monthTag);
  const overrideFor = key => monthTag ? activeOverrides.get(`${key}|${monthTag}`) : undefined;
  const isActiveThisMonth = key => {
    if (!monthTag) return true; // no month context given — behave as before (used by suggestion lists etc.)
    if (monthIsConfigured) return activeOverrides.has(`${key}|${monthTag}`);
    return true; // month never configured — legacy fallback, show everything not globally hidden
  };

  detected.forEach(bill => {
    const rule = byKey.get(bill.key);
    if (rule?.status === 'hidden') return; // deleted everywhere, for good — the rare, explicit case
    if (!isActiveThisMonth(bill.key)) return;
    const ov = overrideFor(bill.key);

    out.push({
      ...bill,
      label:      ov?.label ?? rule?.label ?? bill.label,
      amount:     ov?.amount != null ? Number(ov.amount) : (rule?.amount != null ? Number(rule.amount) : bill.amount),
      day:        ov?.day != null ? Number(ov.day) : (rule?.day != null ? Number(rule.day) : bill.day),
      category:   ov?.category ?? rule?.category ?? bill.category,
      confidence: rule?.status === 'confirmed' ? 'high' : bill.confidence,
      edited:     !!ov || (!!rule && rule.status !== 'auto'),
      detected:   true,
    });
  });

  // Bills the user added by hand
  rules.filter(r => r.status === 'manual').forEach(r => {
    if (!isActiveThisMonth(r.key)) return;
    const ov = overrideFor(r.key);
    out.push({
      key:        r.key,
      label:      ov?.label ?? (r.label || 'Untitled bill'),
      amount:     ov?.amount != null ? Number(ov.amount) : (Number(r.amount) || 0),
      day:        ov?.day != null ? Number(ov.day) : (Number(r.day) || 1),
      category:   ov?.category ?? (r.category || 'other'),
      monthsSeen: 0,
      confidence: 'high',
      varies:     false,
      edited:     true,
      detected:   false,
      manual:     true,
    });
  });

  return out.sort((a, b) => b.amount - a.amount);
}

/**
 * Bills that were due in a PAST month and never got marked paid — either by a
 * matching transaction or a manual tick — don't just vanish when the month
 * changes. They carry forward as overdue until someone closes them out.
 *
 * Only meaningful when (year, month) is the month you're actually sitting in
 * today — browsing an old or future month doesn't need carry-forward, since
 * that month's own schedule already tells the whole story for that month.
 *
 * `monthsBack` bounds how far to look, so a renamed or discontinued bill
 * doesn't generate months of noise forever.
 */
export function getCarriedOverBills(confirmed, history, allPayments, year, month,
                                     today = new Date(), monthsBack = 6) {
  const viewingCurrentMonth = year === today.getFullYear() && month === today.getMonth();
  if (!viewingCurrentMonth) return [];

  // Every (key, year, month) combination ticked paid by hand, anywhere
  const manualPaidSet = new Set((allPayments || []).map(p => `${p.key}|${p.year}-${p.month}`));

  // Every debit transaction we have, grouped by month, so "was this bill
  // charged in month M" can be answered without a fresh query per month
  const txByMonth = new Map(); // "year-month" -> Set(merchantKey)
  (history || []).forEach(t => {
    if (t.direction === 'credit' || t._type === 'credit') return;
    const mk = monthKey(t);
    if (!txByMonth.has(mk)) txByMonth.set(mk, new Set());
    txByMonth.get(mk).add(merchantKey(txnText(t)));
  });

  const out = [];

  confirmed.forEach(bill => {
    for (let i = 1; i <= monthsBack; i++) {
      let checkMonth = month - i;
      let checkYear  = year;
      while (checkMonth < 0) { checkMonth += 12; checkYear -= 1; }
      const mkKey = `${checkYear}-${checkMonth}`;

      const seen = txByMonth.get(mkKey);
      const chargedThatMonth = !!seen && [...billMatchKeys(bill)].some(k => seen.has(k));
      const tickedThatMonth  = manualPaidSet.has(`${bill.key}|${mkKey}`);
      // Paid (or ticked) that month — nothing owed from here further back
      if (chargedThatMonth || tickedThatMonth) break;

      // No statement data at all reaches this far back — stop, there's
      // nothing left to check
      if (!txByMonth.has(mkKey)) break;

      const date = safeDate(checkYear, checkMonth, bill.day);
      out.push({
        ...bill,
        date,
        daysAway: Math.round((date - today) / DAY),
        status: 'overdue',
        carriedFrom: { year: checkYear, month: checkMonth },
        seenInData: false,
        manualOnly: false,
        viewingCurrentMonth: true,
      });
    }
  });

  return out.sort((a, b) => a.date - b.date);
}
