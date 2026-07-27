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
export async function parsePDFStatement(file, source) {
  if (!KEY) throw new Error('VITE_ANTHROPIC_API_KEY is required for PDF parsing.');

  if (file.size > 25 * 1024 * 1024) {
    throw new Error('That PDF is larger than 25MB. Try splitting it, or export a shorter date range.');
  }

  const base64 = await toBase64(file);
  const uid    = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const PROMPT = `You are analyzing a Canadian bank or credit card statement PDF.

Extract EVERY transaction line and return a JSON object with this exact structure:
{
  "account": "account name/number if visible",
  "period": "statement period if visible",
  "warnings": ["any notes about data quality or things the user should check"],
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "exact merchant/payee name from statement",
      "amount": 87.43,
      "type": "debit",
      "confidence": "high|medium|low"
    }
  ]
}

RULES — follow exactly:
- date: must be YYYY-MM-DD. If only month/day visible, infer year from statement period.
- amount: always a positive number (absolute value)
- type: "debit" = money spent/withdrawn/charged. "credit" = money received/deposited/refund.
- confidence: "low" if the row was hard to read (blurry, cut off, partial)
- INCLUDE: all purchases, withdrawals, transfers out, service charges, interest charges
- INCLUDE as type "credit": deposits, payroll, refunds, e-transfers received
- EXCLUDE: opening balance, closing balance, running totals, page headers
- EXCLUDE: rows that are purely labels with no transaction (e.g. "Previous balance")
- If you see a transaction twice on the same date with the same amount, include BOTH 
  and add a warning — the user should confirm if it's a duplicate or a real repeat purchase.
- Do NOT skip any transaction. It is better to include uncertain rows than to miss them.
- Return ONLY the JSON object. No markdown, no explanation.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-6',
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

  // Build rows compatible with the rest of the app
  const { categorize } = await import('./categorize.js');

  const rows = (parsed.transactions || []).map(tx => {
    // Parse date
    let date = tx.date || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = new Date().toISOString().slice(0, 10);

    const dateObj = new Date(date + 'T00:00:00');
    const month   = dateObj.getMonth();
    const year    = dateObj.getFullYear();

    return {
      id:          uid(),
      date,
      description: tx.description || '(unknown)',
      amount:      Math.abs(parseFloat(tx.amount) || 0),
      category:    categorize(tx.description || ''),
      source,
      month,
      year,
      _type:       tx.type || 'debit',      // 'debit' | 'credit'
      _confidence: tx.confidence || 'high',
      _fromPDF:    true,
    };
  });

  // Filter: keep debits + flag credits for user review
  // The validation step (in App.jsx) will ask about credits
  return {
    rows,
    rawCount,
    warnings,
    account: parsed.account || '',
    period:  parsed.period  || '',
  };
}
