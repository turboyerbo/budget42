/**
 * Smart data quality checks run after parsing (CSV or PDF) and before import.
 * Returns issues the user should confirm before finalising the import.
 */

// ── Duplicate detection ───────────────────────────────────────────────────────

/**
 * Find rows that look like duplicates of existing bank_imports in Supabase,
 * or duplicates within the new batch itself.
 */
export function detectDuplicates(newRows, existingRows) {
  const issues = [];
  const seen   = new Map(); // "date|amount" → first occurrence

  newRows.forEach(row => {
    // Same date + same amount within the NEW batch
    const key = `${row.date}|${row.amount.toFixed(2)}`;
    if (seen.has(key)) {
      const prev = seen.get(key);
      issues.push({
        id:      `dup_batch_${row.id}`,
        type:    'duplicate_in_batch',
        row,
        against: prev,
        firstId:  prev.id,
        secondId: row.id,
        question:
          `It looks like you may have the same transaction twice on ${row.date}: ` +
          `"${prev.description}" and "${row.description}" both for $${row.amount.toFixed(2)}. ` +
          `Were these two separate purchases, or should we only import one?`,
        options: ['Keep both', 'Keep first only', 'Keep second only'],
        default: 'Keep both',
      });
    } else {
      seen.set(key, row);
    }

    // Match against already-imported data
    const match = existingRows.find(
      ex => ex.date === row.date && Math.abs(ex.amount - row.amount) < 0.02
    );
    if (match) {
      issues.push({
        id:      `dup_existing_${row.id}`,
        type:    'duplicate_existing',
        row,
        against: match,
        question:
          `We already have a $${row.amount.toFixed(2)} transaction on ${row.date} ` +
          `("${match.description}"). This new one is "${row.description}". ` +
          `Are these the same purchase (skip new one) or two different purchases?`,
        options: ['Skip — already imported', 'Import anyway — different purchase'],
        default: 'Skip — already imported',
      });
    }
  });

  return issues;
}

// ── Income / credit detection ─────────────────────────────────────────────────

/**
 * Find rows that look like income (credits) rather than spending.
 * PDF parser marks them with _type='credit'. CSV parser catches them via _skip.
 * Returns an array of issues for user confirmation.
 */
export function detectCredits(rows) {
  const INCOME_KEYWORDS = [
    'payroll', 'direct deposit', 'e-transfer received', 'deposit', 'refund',
    'rebate', 'interest earned', 'norr architect', 'sunlife', 'sun life',
    'transfer in', 'e_trfin', 'credit', 'government', 'cra ', 'hsbc', 'rbc',
  ];

  const issues = [];
  rows.forEach(row => {
    const isMarkedCredit = row._type === 'credit';
    const d = (row.description || '').toLowerCase();
    const matchesKeyword = INCOME_KEYWORDS.some(kw => d.includes(kw));

    if (isMarkedCredit || matchesKeyword) {
      issues.push({
        id:      `credit_${row.id}`,
        type:    'credit_check',
        row,
        question:
          `Was "${ row.description }" ($${row.amount.toFixed(2)} on ${row.date}) ` +
          `money you RECEIVED rather than money you SPENT? ` +
          `It's important we get this right so your spending history stays accurate.`,
        options: ['Yes — this is income, skip it', 'No — this is a debit, keep it'],
        default: 'Yes — this is income, skip it',
      });
    }
  });
  return issues;
}

// ── Large / unusual transaction check ────────────────────────────────────────

/**
 * Flag unusually large single transactions (> 3× the avg) so the user can
 * confirm they're real spending and not a data error.
 */
export function detectLargeTransactions(rows) {
  if (rows.length < 3) return [];
  const amounts = rows.map(r => r.amount);
  const avg     = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  const issues  = [];

  rows.forEach(row => {
    if (row.amount > avg * 4 && row.amount > 500) {
      issues.push({
        id:      `large_${row.id}`,
        type:    'large_transaction',
        row,
        question:
          `$${row.amount.toFixed(2)} on ${row.date} ("${row.description}") is much ` +
          `larger than your typical transaction ($${avg.toFixed(0)} avg). ` +
          `Is this correct, or does it look like a data error?`,
        options: ['Yes — this is correct', 'Looks wrong — skip it'],
        default: 'Yes — this is correct',
      });
    }
  });
  return issues;
}

// ── Build full validation report ──────────────────────────────────────────────

export function buildValidationReport(newRows, existingRows) {
  return [
    ...detectCredits(newRows),
    ...detectDuplicates(newRows, existingRows),
    ...detectLargeTransactions(newRows.filter(r => r._type !== 'credit')),
  ];
}
