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

/**
 * Split recurring charges into those already seen this month and those still
 * expected. Only the latter is a commitment.
 */
export function splitRecurring(recurring, thisMonthTx) {
  const seenKeys = new Set(
    thisMonthTx
      .filter(t => (t.direction ?? t._type ?? 'debit') !== 'credit')
      .map(t => merchantKey(t.description || t.note || ''))
  );

  const paid = [], due = [];
  recurring.forEach(r => (seenKeys.has(r.key) ? paid : due).push(r));

  return {
    paid,
    due,
    dueTotal:  due.reduce((a, r) => a + r.amount, 0),
    paidTotal: paid.reduce((a, r) => a + r.amount, 0),
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
  const { paid } = splitRecurring(recurring, thisMonthTx);
  const paidKeys = new Set(paid.map(r => r.key));

  // Ticked off by hand. Useful in the gap between paying a bill and the
  // statement arriving, which can be weeks.
  const manual = new Map(manualPaid.map(p => [p.key, p]));

  const midnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const viewingCurrentMonth =
    year === today.getFullYear() && month === today.getMonth();

  const entries = recurring.map(r => {
    const date       = safeDate(year, month, r.day);
    const seenInData = paidKeys.has(r.key);
    const tick       = manual.get(r.key);
    const daysAway   = Math.round((date - midnight) / DAY);

    let status = 'due';
    if (seenInData || tick) status = 'paid';
    else if (viewingCurrentMonth && daysAway < 0) status = 'overdue';

    return {
      ...r, date, daysAway, status, viewingCurrentMonth,
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

  return {
    entries,
    outstanding,
    outstandingTotal: outstanding.reduce((a, e) => a + e.amount, 0),
    paidTotal:        entries.filter(e => e.status === 'paid').reduce((a, e) => a + e.amount, 0),
    monthTotal:       entries.reduce((a, e) => a + e.amount, 0),
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
export function applyBillRules(detected, rules = []) {
  const byKey = new Map(rules.map(r => [r.key, r]));
  const out = [];

  detected.forEach(bill => {
    const rule = byKey.get(bill.key);
    if (rule?.status === 'hidden') return;

    out.push({
      ...bill,
      label:      rule?.label  ?? bill.label,
      amount:     rule?.amount != null ? Number(rule.amount) : bill.amount,
      day:        rule?.day    != null ? Number(rule.day)    : bill.day,
      category:   rule?.category ?? bill.category,
      confidence: rule?.status === 'confirmed' ? 'high' : bill.confidence,
      edited:     !!rule && rule.status !== 'auto',
      detected:   true,
    });
  });

  // Bills the user added by hand
  rules.filter(r => r.status === 'manual').forEach(r => {
    out.push({
      key:        r.key,
      label:      r.label || 'Untitled bill',
      amount:     Number(r.amount) || 0,
      day:        Number(r.day) || 1,
      category:   r.category || 'other',
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
    txByMonth.get(mk).add(merchantKey(t.description || t.note || ''));
  });

  const out = [];

  confirmed.forEach(bill => {
    for (let i = 1; i <= monthsBack; i++) {
      let checkMonth = month - i;
      let checkYear  = year;
      while (checkMonth < 0) { checkMonth += 12; checkYear -= 1; }
      const mkKey = `${checkYear}-${checkMonth}`;

      const chargedThatMonth = txByMonth.get(mkKey)?.has(bill.key);
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
