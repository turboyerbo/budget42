/**
 * Data quality checks run after parsing and before import.
 *
 * Two distinct problems this solves:
 *   1. TRUE DUPLICATES — the same purchase imported twice, usually because
 *      two statements overlap in date range.
 *   2. INTERNAL TRANSFERS — money moving between the user's own accounts.
 *      A credit-card payment is a debit on the chequing statement AND a credit
 *      on the card statement. Counting both as spending doubles the total and
 *      is the single biggest source of inflated numbers.
 *
 * Anything unambiguous is fixed automatically and reported. Only genuinely
 * uncertain cases become questions.
 */

// ── Description normalisation ────────────────────────────────────────────────
// Payment processors prepend tags and append store/reference numbers, so the
// same merchant reads differently on two statements:
//   "SQ *BLUE BOTTLE 8891"  vs  "SQ *BLUE BOTTLE"
//   "TST* PIZZERIA #4"      vs  "TST* PIZZERIA"
const PROCESSOR_PREFIXES =
  /^(sq|tst|sp|py|pp|paypal|amzn mktp|amz|dd|ub|lyft|int'?l)\s*[\*\-#]?\s*/i;

export function normalizeDesc(desc) {
  return String(desc || '')
    .toLowerCase()
    .replace(PROCESSOR_PREFIXES, '')       // strip SQ*, TST*, PAYPAL *, etc
    .replace(/[\*#]/g, ' ')
    .replace(/\b\d{4,}\b/g, ' ')           // store / reference numbers
    .replace(/\b(pos|purchase|debit|visa|mastercard|mc|inc|ltd|corp)\b/g, ' ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const daysApart = (a, b) =>
  Math.abs(new Date(a + 'T00:00:00') - new Date(b + 'T00:00:00')) / 86400000;

const money = n => '$' + Math.abs(n).toFixed(2);

// ── Internal transfer / credit-card payment detection ────────────────────────
const PAYMENT_WORDS = /payment|pmt|paiement|thank you|autopay|pre.?auth|transfer|trf|xfer|e-?transfer|virement/i;

/**
 * Pair a debit on one account with a credit of the same amount on another
 * account within a few days. That pair is one movement of money, not two
 * pieces of spending — both halves get excluded.
 */
export function detectInternalTransfers(rows) {
  const issues   = [];
  const consumed = new Set();

  const debits  = rows.filter(r => (r._type || 'debit') === 'debit');
  const credits = rows.filter(r => r._type === 'credit');

  debits.forEach(d => {
    if (consumed.has(d.id)) return;

    const match = credits.find(c =>
      !consumed.has(c.id) &&
      Math.abs(c.amount - d.amount) < 0.02 &&
      daysApart(c.date, d.date) <= 3 &&
      c.source !== d.source                   // must be two different accounts
    );
    if (!match) return;

    consumed.add(d.id); consumed.add(match.id);

    const looksLikePayment =
      PAYMENT_WORDS.test(d.description) || PAYMENT_WORDS.test(match.description) ||
      d._internal || match._internal;

    issues.push({
      id:        `transfer_${d.id}`,
      type:      'internal_transfer',
      row:       d,
      against:   match,
      pairIds:   [d.id, match.id],
      autoFixed: looksLikePayment,            // confident → fix silently
      summary:   `${money(d.amount)} moved between your own accounts on ${d.date}`,
      question:
        `${money(d.amount)} left one account and arrived in another around ${d.date} ` +
        `("${d.description}" and "${match.description}"). That looks like you moving ` +
        `your own money — paying a credit card, for example — rather than two separate ` +
        `purchases. Counting both would double your spending.`,
      options: ['Yes — money moved between my accounts, exclude both',
                'No — these are two genuine purchases, keep both'],
      default: 'Yes — money moved between my accounts, exclude both',
    });
  });

  return issues;
}

/**
 * A credit-card payment that has no matching partner in this batch — the other
 * statement simply wasn't uploaded. Still not spending.
 */
export function detectStandalonePayments(rows, pairedIds) {
  const issues = [];
  rows.forEach(row => {
    if (pairedIds.has(row.id)) return;
    if (!PAYMENT_WORDS.test(row.description) && !row._internal) return;
    if (row.amount < 20) return;                       // ignore small fees

    issues.push({
      id:        `payment_${row.id}`,
      type:      'card_payment',
      row,
      autoFixed: false,
      summary:   `${money(row.amount)} — "${row.description}"`,
      question:
        `"${row.description}" on ${row.date} for ${money(row.amount)} looks like a ` +
        `payment or transfer rather than a purchase. If this is you paying off a card ` +
        `or moving money, it shouldn't count as spending — the original purchases ` +
        `are already counted on the card statement.`,
      options: ['Skip it — this is a payment or transfer',
                'Keep it — this really was a purchase'],
      default: 'Skip it — this is a payment or transfer',
    });
  });
  return issues;
}

// ── Duplicate detection ──────────────────────────────────────────────────────
/**
 * Exact duplicates (same normalised merchant, same day, same amount) are fixed
 * automatically. Near-matches (same merchant and amount a day or two apart, or
 * same day and amount with a different merchant) become questions.
 */
export function detectDuplicates(newRows, existingRows) {
  const issues = [];
  const seen   = new Map();

  newRows.forEach(row => {
    const norm = normalizeDesc(row.description);
    const amt  = row.amount.toFixed(2);

    // ── within this batch ──
    const exactKey = `${row.date}|${amt}|${norm}`;
    if (seen.has(exactKey)) {
      const prev = seen.get(exactKey);
      issues.push({
        id:        `dup_exact_${row.id}`,
        type:      'duplicate_in_batch',
        row, against: prev,
        firstId: prev.id, secondId: row.id,
        autoFixed: true,                      // identical on every field
        summary:   `${money(row.amount)} · ${row.description} · ${row.date}`,
        question:
          `"${row.description}" appears twice on ${row.date} for ${money(row.amount)}. ` +
          `Identical merchant, day and amount usually means the same purchase got ` +
          `imported twice — but it can also be two genuine trips to the same shop.`,
        options: ['Keep both', 'Keep first only', 'Keep second only'],
        default: 'Keep first only',
      });
    } else {
      seen.set(exactKey, row);
    }

    // ── against what's already in the database ──
    const match = existingRows.find(ex =>
      Math.abs(ex.amount - row.amount) < 0.02 &&
      daysApart(ex.date, row.date) <= 2 &&
      normalizeDesc(ex.description) === norm
    );
    if (match) {
      const sameDay = match.date === row.date;
      issues.push({
        id:        `dup_existing_${row.id}`,
        type:      'duplicate_existing',
        row, against: match,
        autoFixed: sameDay,                   // same day + merchant + amount
        summary:   `${money(row.amount)} · ${row.description} · already imported ${match.date}`,
        question:
          `You already have "${match.description}" for ${money(match.amount)} on ` +
          `${match.date}. This file has "${row.description}" for ${money(row.amount)} ` +
          `on ${row.date}. Same purchase arriving from an overlapping statement, ` +
          `or a separate one?`,
        options: ['Skip — already imported', 'Import anyway — different purchase'],
        default: 'Skip — already imported',
      });
    }
  });

  return issues;
}

// ── Income landing in a spending import ──────────────────────────────────────
const INCOME_KEYWORDS = [
  'payroll','direct deposit','deposit','refund','rebate','interest earned',
  'norr architect','sunlife','sun life','e-?transfer received','government','cra ',
];

export function detectCredits(rows, handledIds) {
  const issues = [];
  rows.forEach(row => {
    if (handledIds.has(row.id)) return;             // already covered elsewhere
    const d = (row.description || '').toLowerCase();
    const isCredit = row._type === 'credit';
    const kw = INCOME_KEYWORDS.some(k => new RegExp(k).test(d));
    if (!isCredit && !kw) return;

    issues.push({
      id:        `credit_${row.id}`,
      type:      'credit_check',
      row,
      autoFixed: isCredit && kw,                    // both signals agree
      summary:   `${money(row.amount)} · ${row.description}`,
      question:
        `Was "${row.description}" (${money(row.amount)} on ${row.date}) money you ` +
        `RECEIVED rather than money you SPENT? It gets filed as income rather than ` +
        `discarded, so your budget knows what actually came in.`,
      options: ['Yes — file it as income', 'No — this is spending'],
      default: 'Yes — file it as income',
    });
  });
  return issues;
}

// ── Unusually large transactions ─────────────────────────────────────────────
export function detectLargeTransactions(rows, handledIds) {
  const spend = rows.filter(r => (r._type || 'debit') === 'debit' && !handledIds.has(r.id));
  if (spend.length < 3) return [];
  const avg = spend.reduce((a, b) => a + b.amount, 0) / spend.length;

  return spend
    .filter(r => r.amount > avg * 4 && r.amount > 500)
    .map(row => ({
      id:        `large_${row.id}`,
      type:      'large_transaction',
      row,
      autoFixed: false,
      summary:   `${money(row.amount)} · ${row.description}`,
      question:
        `${money(row.amount)} on ${row.date} ("${row.description}") is far larger than ` +
        `your typical transaction of about $${avg.toFixed(0)}. Is that right, or does ` +
        `it look like a misread?`,
      options: ['Yes — that is correct', 'Looks wrong — skip it'],
      default: 'Yes — that is correct',
    }));
}

// ── Orchestrator ─────────────────────────────────────────────────────────────
/**
 * Returns { autoFixed, questions } so the UI can report confident corrections
 * as a summary and only interrupt the user for the ambiguous remainder.
 */
export function buildValidationReport(newRows, existingRows, partnerIssues = []) {
  const transfers = detectInternalTransfers(newRows);

  const paired = new Set();
  transfers.forEach(t => t.pairIds.forEach(id => paired.add(id)));
  partnerIssues.forEach(p => paired.add(p.row.id));

  const payments = detectStandalonePayments(newRows, paired);
  payments.forEach(p => paired.add(p.row.id));

  const dupes   = detectDuplicates(newRows, existingRows);
  const handled = new Set(paired);
  dupes.forEach(d => handled.add(d.row.id));

  const credits = detectCredits(newRows, handled);
  credits.forEach(c => handled.add(c.row.id));

  const large = detectLargeTransactions(newRows, handled);

  const all = [...partnerIssues, ...transfers, ...payments, ...dupes, ...credits, ...large];

  return {
    autoFixed: all.filter(i => i.autoFixed),
    questions: all.filter(i => !i.autoFixed),
    all,
  };
}
