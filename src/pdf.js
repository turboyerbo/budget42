import { MODEL_SMART } from './models.js';
import { callClaude, textOf } from './claude.js';
import { splitPDF } from './pdfsplit.js';
/**
 * PDF bank statement parser using Claude's native document vision.
 * When a CSV fails or a bank's CSV export is unusable, the user can
 * upload their statement PDF instead and Claude extracts all transactions.
 */

// Availability is now decided by the server, not by a bundled key
export const PDF_AVAILABLE = true;


/**
 * Parse a bank statement PDF using Claude.
 * Returns { rows, rawCount, warnings }
 *   rows      — array ready for the review screen
 *   rawCount  — how many raw transactions Claude found before filtering
 *   warnings  — human-readable notes from Claude about the document
 */

// Sent with every page batch. Kept at module scope so it is defined exactly
// once and cannot go missing when the calling code is refactored.
const PROMPT = `You are analyzing a Canadian bank or credit card statement PDF.

IMPORTANT: this document may contain MORE THAN ONE account (for example a
chequing statement and a credit card statement bundled together, or several
months). Identify every account present and tag each transaction with the
account it belongs to. You may be given only a few pages of a longer statement;
that is expected. Report what you can see.

Return a JSON object with this exact structure:
{
  "accounts": [
    {
      "key": "acct1",
      "institution": "BMO|CTFS|WS_JOINT|WS_PERS|PC_MC|CIBC|UNKNOWN",
      "institutionName": "the name printed on the statement",
      "accountLabel": "e.g. Chequing ****4073",
      "kind": "bank|credit",
      "period": "statement period if visible",
      "confidence": "high|medium|low"
    }
  ],
  "warnings": ["anything the user should double-check"],
  "transactions": [
    {
      "account": "acct1",
      "date": "YYYY-MM-DD",
      "description": "exact merchant/payee name",
      "amount": 87.43,
      "type": "debit",
      "confidence": "high|medium|low"
    }
  ]
}

INSTITUTION MAPPING — map what is printed on the statement to these ids:
- Bank of Montreal / BMO            -> BMO
- Canadian Tire / Triangle / CTFS   -> CTFS
- Wealthsimple, joint account       -> WS_JOINT
- Wealthsimple, personal account    -> WS_PERS
- PC Financial / President's Choice -> PC_MC
- CIBC                              -> CIBC
- anything else / not stated        -> UNKNOWN

RULES — follow exactly:
- date: must be YYYY-MM-DD. If only month/day is visible, infer the year from the statement period.
- amount: always a positive number (absolute value).
- type: "debit" = money spent/withdrawn/charged. "credit" = money received/deposited/refunded.
- account: must match one of the "key" values you defined in "accounts".
- If only one account is present, still return the accounts array with a single entry.
- If no account details are visible on these pages, use key "acct1" and institution "UNKNOWN".
- confidence: "low" if the row was hard to read (blurry, cut off, partial).
- INCLUDE: purchases, withdrawals, transfers out, service charges, interest charges.
- INCLUDE as type "credit": deposits, payroll, refunds, e-transfers received.
- EXCLUDE: opening balance, closing balance, running totals, page headers.
- EXCLUDE rows that are purely labels with no transaction (e.g. "Previous balance").
- If a transaction appears twice on the same date for the same amount, include BOTH
  and add a warning — the user will confirm whether it is a real repeat purchase.
- Do NOT skip any transaction. Better to include an uncertain row than to miss it.
- If these pages contain no transactions at all, return an empty transactions array.
- Return ONLY the JSON object. No markdown, no explanation.`;

export async function parsePDFStatement(file, onProgress) {
  if (file.size > 25 * 1024 * 1024) {
    throw new Error('That PDF is larger than 25MB. Try splitting it, or export a shorter date range.');
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  // Several small requests rather than one long one — see pdfsplit.js
  const batches = await splitPDF(file, 3);

  const allAccounts   = [];
  const allTxns       = [];
  const allWarnings   = [];

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    onProgress?.({
      batch: b + 1,
      batches: batches.length,
      from: batch.from,
      to: batch.to,
      total: batch.total,
    });

    let data;
    try {
      data = await callClaude({
        model:      MODEL_SMART,
        max_tokens: 8192,
        messages: [{
          role: 'user',
          content: [
            { type:'document',
              source:{ type:'base64', media_type:'application/pdf', data: batch.base64 } },
            { type:'text', text: PROMPT },
          ],
        }],
      });
    } catch (err) {
      // One bad batch should not throw away the pages that did work
      allWarnings.push(
        `Pages ${batch.from}-${batch.to} could not be read (${err.message}). ` +
        `Transactions on those pages are missing.`);
      continue;
    }

    let parsed;
    try {
      parsed = JSON.parse(textOf(data));
    } catch {
      allWarnings.push(`Pages ${batch.from}-${batch.to} returned something unreadable and were skipped.`);
      continue;
    }

    (parsed.warnings || []).forEach(w => allWarnings.push(w));

    // Account keys are only unique within a batch, so namespace them
    const accts = (parsed.accounts?.length ? parsed.accounts : [{
      key:'acct1', institution:'UNKNOWN', institutionName:'', accountLabel:'',
      kind:'bank', confidence:'none',
    }]).map(a => ({ ...a, key: `b${b}_${a.key}` }));

    accts.forEach(a => {
      const seen = allAccounts.find(x =>
        x.institution === a.institution && x.accountLabel === a.accountLabel);
      if (!seen) allAccounts.push(a);
    });

    const byKey = Object.fromEntries(accts.map(a => [a.key, a]));

    (parsed.transactions || []).forEach(tx => {
      const acct = byKey[`b${b}_${tx.account}`] || accts[0];
      let date = tx.date || '';
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = new Date().toISOString().slice(0, 10);
      const dateObj = new Date(date + 'T00:00:00');

      allTxns.push({
        id:          uid(),
        date,
        description: tx.description || '(unknown)',
        amount:      Math.abs(parseFloat(tx.amount) || 0),
        category:    'other',                     // filled in below
        source:      acct.institution || 'UNKNOWN',
        month:       dateObj.getMonth(),
        year:        dateObj.getFullYear(),
        _type:       tx.type || 'debit',
        _confidence: tx.confidence || 'high',
        _acctLabel:  acct.accountLabel || '',
        _fromPDF:    true,
      });
    });
  }

  if (allTxns.length === 0 && allWarnings.length > 0) {
    throw new Error(allWarnings[0]);
  }

  // Categorise once, at the end
  const { categorize } = await import('./categorize.js');
  allTxns.forEach(t => { t.category = categorize(t.description); });

  return {
    rows:      allTxns,
    rawCount:  allTxns.length,
    warnings:  allWarnings,
    accounts:  allAccounts,
  };
}
