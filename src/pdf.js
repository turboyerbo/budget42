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
