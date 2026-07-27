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
import { normalizeDesc } from './validate.js';

const monthKey = t => `${t.year}-${t.month}`;
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
export function detectRecurring(imports, { minMonths = 2, tolerance = 0.25 } = {}) {
  const groups = new Map();

  imports.forEach(t => {
    // Money in and money moved are not bills
    if (t.direction === 'credit') return;
    if (['income', 'cc_payment', 'transfer'].includes(t.category)) return;

    const key = normalizeDesc(t.description || '');
    if (!key || key.length < 3) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  });

  const out = [];

  groups.forEach((rows, key) => {
    const months = new Set(rows.map(monthKey));
    if (months.size < minMonths) return;

    const amounts = rows.map(r => r.amount);
    const typical = median(amounts);
    if (!typical) return;

    // Two tests, both aimed at telling a bill apart from a habit.
    //
    // 1. Spread, not distance from the median. Comparing each amount to the
    //    median individually is too forgiving: 130 / 160 / 190 all sit within
    //    25% of 160, yet that is obviously variable shopping, not a bill.
    const spread = (Math.max(...amounts) - Math.min(...amounts)) / typical;
    if (spread > tolerance) return;

    const days = rows.map(r => dayOf(r.date)).sort((a, b) => a - b);

    // 2. Bills land on roughly the same day each month. Groceries do not.
    //    Allow a week of drift for weekends and processing delays.
    const dayDrift = days[days.length - 1] - days[0];
    const wrapsMonthEnd = days[0] <= 3 && days[days.length - 1] >= 27;  // e.g. 30th/1st
    if (dayDrift > 8 && !wrapsMonthEnd) return;

    out.push({
      key,
      label:      rows[rows.length - 1].description,
      amount:     Math.round(typical * 100) / 100,
      category:   rows[rows.length - 1].category || 'other',
      source:     rows[rows.length - 1].source,
      day:        days[Math.floor(days.length / 2)],
      monthsSeen: months.size,
      varies:     Math.max(...amounts) - Math.min(...amounts) > typical * 0.1,
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
      .map(t => normalizeDesc(t.description || t.note || ''))
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
