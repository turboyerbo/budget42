/**
 * Cross-partner reconciliation.
 *
 * Once both people have uploaded, their two sets of statements check each other:
 *
 *   1. PARTNER TRANSFER — one of you e-transfers the other. It shows as money
 *      out on one person's statement and money in on the other's. That is the
 *      household moving its own money; counting it as spending inflates the
 *      total exactly the way a credit-card payment does.
 *
 *   2. SHARED MOMENT — same merchant, same day, both of you. You were out
 *      together. Worth surfacing rather than hiding: it is real spending, just
 *      spending you did as a couple.
 */
import { normalizeDesc } from './validate.js';

const daysApart = (a, b) =>
  Math.abs(new Date(a + 'T00:00:00') - new Date(b + 'T00:00:00')) / 86400000;

export const firstName = w => String(w || '').trim().split(/\s+/)[0].toLowerCase();
export const samePerson = (a, b) => firstName(a) && firstName(a) === firstName(b);

const TRANSFER_WORDS =
  /e-?transfer|etransfer|interac|send money|transfer to|transfer from|virement|zelle/i;

// ── 1. Partner-to-partner transfers ──────────────────────────────────────────
/**
 * Match a new row against rows already in the database that belong to the
 * OTHER person and move the opposite way. Returns validation-shaped issues.
 */
export function detectPartnerTransfers(newRows, existingRows) {
  const issues = [];
  const used   = new Set();

  newRows.forEach(row => {
    if (used.has(row.id)) return;
    const dir = row._type || 'debit';

    const match = existingRows.find(ex => {
      if (used.has(ex.id)) return false;
      if (samePerson(ex.who, row.who)) return false;      // must be the partner
      if (!ex.direction) return false;                    // pre-migration row
      if (ex.direction === dir) return false;             // must be opposite
      if (Math.abs(ex.amount - row.amount) > 0.02) return false;
      return daysApart(ex.date, row.date) <= 3;
    });
    if (!match) return;

    used.add(row.id);

    const named = TRANSFER_WORDS.test(row.description) ||
                  TRANSFER_WORDS.test(match.description || '');
    const from = dir === 'debit' ? row.who : match.who;
    const to   = dir === 'debit' ? match.who : row.who;
    const cap  = n => String(n || 'your partner').charAt(0).toUpperCase() +
                      String(n || '').slice(1);

    issues.push({
      id:        `partner_${row.id}`,
      type:      'partner_transfer',
      row,
      against:   match,
      autoFixed: named,                 // description says transfer → confident
      summary:   `$${row.amount.toFixed(2)} sent from ${cap(from)} to ${cap(to)}`,
      question:
        `${cap(from)} sent $${row.amount.toFixed(2)} and ${cap(to)} received the same ` +
        `amount around ${row.date}. That looks like the two of you moving money ` +
        `between yourselves rather than spending it. Counting both sides would ` +
        `inflate your household total.`,
      options: ['Yes — that was a transfer between us, exclude it',
                'No — keep it as spending'],
      default: 'Yes — that was a transfer between us, exclude it',
    });
  });

  return issues;
}

// ── 2. Shared moments ────────────────────────────────────────────────────────
/**
 * Same merchant, same day, two different people = you were there together.
 *
 * Guard: if the amount AND the source account also match, that is far more
 * likely to be the same statement imported by both of you. Those are returned
 * separately as `suspected` rather than celebrated as a date.
 *
 * Returns { shared: Map<id, info>, suspected: Array<[a,b]> }
 */
export function findSharedMoments(transactions) {
  const shared    = new Map();
  const suspected = [];

  // Bucket by merchant + day
  const buckets = new Map();
  transactions.forEach(t => {
    const desc = t.description || t.note || '';
    const norm = normalizeDesc(desc);
    if (!norm || !t.date) return;
    const key = `${t.date}|${norm}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(t);
  });

  buckets.forEach(group => {
    if (group.length < 2) return;

    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j];
        if (samePerson(a.who, b.who)) continue;      // same person → not a date
        if (!firstName(a.who) || !firstName(b.who)) continue;

        const sameAmount = Math.abs(a.amount - b.amount) < 0.02;
        const sameSource = a.source && a.source === b.source;

        if (sameAmount && sameSource) {
          // Almost certainly one statement uploaded twice, not an outing
          suspected.push([a, b]);
          continue;
        }

        const info = {
          merchant: a.description || a.note || '',
          date:     a.date,
          total:    a.amount + b.amount,
          people:   [a.who, b.who],
        };
        shared.set(a.id, { ...info, partner: b.who, partnerAmount: b.amount });
        shared.set(b.id, { ...info, partner: a.who, partnerAmount: a.amount });
      }
    }
  });

  return { shared, suspected };
}

/** Roll the shared moments up into something displayable. */
export function summariseTogether(sharedMap) {
  const outings = new Map();          // one entry per merchant+date pair
  sharedMap.forEach(info => {
    const key = `${info.date}|${info.merchant}`;
    if (!outings.has(key)) outings.set(key, info);
  });
  const list  = [...outings.values()].sort((a, b) => new Date(b.date) - new Date(a.date));
  const total = list.reduce((a, o) => a + o.total, 0);
  return { count: list.length, total, list };
}
