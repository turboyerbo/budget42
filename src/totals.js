/**
 * The month's spending, worked out ONCE, the same way, for every screen.
 *
 * Home, Charges and Bills each used to do their own arithmetic, with slightly
 * different rules. Each figure was defensible on its own, but adding Charges
 * to Bills never produced a number that matched anything. Every screen now
 * calls monthSpending() and just displays what it returns, so:
 *
 *     Charges + Bills Paid = Total Spending      (always, to the cent)
 *     sum of the category rows on Charges = Charges
 *
 * Rules:
 *  - A transaction is either a bill payment or an everyday charge, never both.
 *    Which is which comes from matchBillTransactions(), the same rule the bill
 *    tracker uses to decide a bill is paid.
 *  - A paid bill counts what was actually charged (see buildSchedule).
 *  - Money in (income), card payments and moves between accounts are never
 *    spending, nor is any category flagged "not spending".
 *  - A refund (money IN, filed under a spending category) reduces that
 *    category instead of adding to it.
 */
import { buildSchedule, matchBillTransactions } from './recurring.js';

export const ALWAYS_EXCLUDED = new Set(['income', 'cc_payment', 'transfer', '_skip']);

const cents = n => Math.round(n * 100) / 100;
const catOf = t => t.category || t.cat;

/** Spending is positive; a refund in a spending category is negative. */
export function signedSpend(t) {
  const amt = Number(t.amount) || 0;
  const dir = t.direction ?? t._type ?? 'debit';
  return dir === 'credit' ? -Math.abs(amt) : amt;
}

/**
 * @param everything  every transaction in the month, BOTH people (bills are
 *                    matched against the whole household)
 * @param viewTx      the same month narrowed to the selected view
 * @param recurring   the confirmed bills active this month
 * @param billPayments manual "paid" ticks for this month
 * @param excludedIds category ids that are never spending (merged with ALWAYS_EXCLUDED)
 * @param billShare   fraction of household bills that belong to this view
 *                    (1 for Combined; the income share for a personal view)
 */
export function monthSpending({ everything = [], viewTx = everything, recurring = [],
                                billPayments = [], excludedIds = new Set(),
                                year, month, today = new Date(), billShare = 1 }) {
  const excluded = new Set([...ALWAYS_EXCLUDED, ...excludedIds]);
  const sched = buildSchedule(recurring, everything, year, month, today, billPayments);
  const { isBillTxn } = matchBillTransactions(recurring, everything);

  const isCharge = t => {
    const c = catOf(t);
    return !!c && !excluded.has(c) && !isBillTxn(t);
  };

  const countable = viewTx.filter(isCharge);
  const chargesByCat = {};
  countable.forEach(t => {
    const c = catOf(t);
    chargesByCat[c] = (chargesByCat[c] || 0) + signedSpend(t);
  });
  Object.keys(chargesByCat).forEach(k => { chargesByCat[k] = cents(chargesByCat[k]); });

  const charges            = cents(countable.reduce((a, t) => a + signedSpend(t), 0));
  const billsPaidHousehold = sched.paidTotal;
  const billsPaid          = cents(billsPaidHousehold * billShare);

  return {
    sched,
    isBillTxn,
    isCharge,
    countable,
    chargesByCat,
    charges,
    billsPaidHousehold,
    billsPaid,
    total: cents(charges + billsPaid),
  };
}

/**
 * Custom categories belong to the month they were created in. A category
 * shows in a month only if it was made for that month, or that month
 * actually has transactions filed under it (so nothing already spent can
 * disappear). A category created before categories were per-month (no
 * year/month recorded) likewise only shows where it has been used.
 */
export function categoriesForMonth(defaultCats, customCats, year, month, monthTx = []) {
  const used = new Set(monthTx.map(catOf).filter(Boolean));
  const mine = (customCats || []).filter(c =>
    (c.year === year && c.month === month) || used.has(c.id));
  return [...defaultCats, ...mine]
    .sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }));
}
