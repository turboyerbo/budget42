import { MODEL_SMART } from './models.js';
/**
 * PDF bank statement parser using Claude's native document vision.
 * When a CSV fails or a bank's CSV export is unusable, the user can
 * upload their statement PDF instead and Claude extracts all transactions.
 */

const KEY = import.meta.env.VITE_ANTHROPIC_API_KEY;

export const PDF_AVAILABLE = !!KEY;

/** Convert a File/Blob to base64 string */
async function toBase64(file) {
  const buffer = await file.arrayBuffer();
  const bytes  = new Uint8Array(buffer);
  const CHUNK  = 0x8000;              // 32KB per pass — avoids UI hang on big PDFs
  const parts  = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK)));
  }
  return btoa(parts.join(''));
}

/**
 * Parse a bank statement PDF using Claude.
 * Returns { rows, rawCount, warnings }
 *   rows      — array ready for the review screen
 *   rawCount  — how many raw transactions Claude found before filtering
 *   warnings  — human-readable notes from Claude about the document
 */
export async function parsePDFStatement(file) {
  if (!KEY) throw new Error('VITE_ANTHROPIC_API_KEY is required for PDF parsing.');

  if (file.size > 25 * 1024 * 1024) {
    throw new Error('That PDF is larger than 25MB. Try splitting it, or export a shorter date range.');
  }

  const base64 = await toBase64(file);
  const uid    = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const PROMPT = `You are analyzing a Canadian bank or credit card statement PDF.

IMPORTANT: this document may contain MORE THAN ONE account (for example a
chequing statement and a credit card statement bundled together, or several
months). Identify every account present and tag each transaction with the
account it belongs to.

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
- confidence: "low" if the row was hard to read (blurry, cut off, partial).
- INCLUDE: purchases, withdrawals, transfers out, service charges, interest charges.
- INCLUDE as type "credit": deposits, payroll, refunds, e-transfers received.
- EXCLUDE: opening balance, closing balance, running totals, page headers.
- EXCLUDE rows that are purely labels with no transaction (e.g. "Previous balance").
- If a transaction appears twice on the same date for the same amount, include BOTH
  and add a warning — the user will confirm whether it is a real repeat purchase.
- Do NOT skip any transaction. Better to include an uncertain row than to miss it.
- Return ONLY the JSON object. No markdown, no explanation.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      MODEL_SMART,
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: [
          {
            type:   'document',
            source: { type: 'base64', media_type: 'application/pdf', data: base64 },
          },
          { type: 'text', text: PROMPT },
        ],
      }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = (data.content?.[0]?.text || '').replace(/```json?|```/g, '').trim();
  const parsed = JSON.parse(text);

  const rawCount = parsed.transactions?.length || 0;
  const warnings = parsed.warnings || [];
  const accounts = parsed.accounts?.length
    ? parsed.accounts
    : [{ key:'acct1', institution:'UNKNOWN', institutionName:'', accountLabel:'', kind:'bank', confidence:'none' }];

  const acctByKey = Object.fromEntries(accounts.map(a => [a.key, a]));

  // Build rows compatible with the rest of the app
  const { categorize } = await import('./categorize.js');

  const rows = (parsed.transactions || []).map(tx => {
    let date = tx.date || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = new Date().toISOString().slice(0, 10);

    const dateObj = new Date(date + 'T00:00:00');
    const acct    = acctByKey[tx.account] || accounts[0];

    return {
      id:          uid(),
      date,
      description: tx.description || '(unknown)',
      amount:      Math.abs(parseFloat(tx.amount) || 0),
      category:    categorize(tx.description || ''),
      source:      acct.institution || 'UNKNOWN',   // per-transaction institution
      month:       dateObj.getMonth(),
      year:        dateObj.getFullYear(),
      _type:       tx.type || 'debit',
      _confidence: tx.confidence || 'high',
      _acctLabel:  acct.accountLabel || '',
      _fromPDF:    true,
    };
  });

  // Filter: keep debits + flag credits for user review
  // The validation step (in App.jsx) will ask about credits
  return {
    rows,
    rawCount,
    warnings,
    accounts,
  };
}
