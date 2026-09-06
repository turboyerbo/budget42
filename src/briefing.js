import { MODEL_FAST } from './models.js';
import { callClaude, textOf } from './claude.js';

/**
 * The "welcome back" briefing shown when either partner opens the app.
 *
 * Two halves, deliberately separated:
 *
 *   buildBriefingFacts()  — pure. Works out what actually happened: the
 *                           week's spending, who spent it, what's about to
 *                           be charged, goal progress, anything odd. No
 *                           network, no AI, fully testable.
 *
 *   writeBriefing()       — asks Claude to turn those facts into a couple of
 *                           readable sentences. Never invents numbers: it is
 *                           given the figures and asked only to phrase them.
 *
 * If Claude is unavailable the facts still render, with a plainly-written
 * fallback line. The briefing must never be a blank box or a spinner that
 * never resolves just because AI is unreachable.
 */

const DAY = 86400000;
const EXCLUDED = new Set(['income', 'cc_payment', 'transfer', '_skip']);
const fmt = n => '$' + Math.abs(Number(n) || 0).toLocaleString('en-CA',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const first = s => String(s || '').trim().split(/\s+/)[0].toLowerCase();
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';

/**
 * @param opts.everything   all transactions + imports for the month
 * @param opts.sched        buildSchedule() output for this month
 * @param opts.goals        goals array
 * @param opts.now          injectable for tests
 */
export function buildBriefingFacts({
  everything = [], sched = null, goals = [], carriedOver = [],
  myName = '', partnerName = '', availableMoney = 0, now = new Date(),
}) {
  const me = first(myName), them = first(partnerName);
  const weekAgo = new Date(now.getTime() - 7 * DAY);
  const parse = d => {
    const [y, m, dd] = String(d || '').split('-').map(Number);
    return (!y || !m || !dd) ? null : new Date(y, m - 1, dd);
  };

  const spend = everything.filter(t =>
    !EXCLUDED.has(t.category || t.cat) && (t.amount || 0) > 0);

  const week = spend.filter(t => { const d = parse(t.date); return d && d >= weekAgo && d <= now; });
  const weekTotal = week.reduce((a, t) => a + t.amount, 0);

  const perPerson = {};
  week.forEach(t => {
    const k = first(t.who) || 'unattributed';
    perPerson[k] = (perPerson[k] || 0) + t.amount;
  });

  const byCat = {};
  week.forEach(t => { const c = t.category || t.cat || 'other';
    byCat[c] = (byCat[c] || 0) + t.amount; });
  const topCategory = Object.entries(byCat).sort((a, b) => b[1] - a[1])[0] || null;

  const biggest = week.slice().sort((a, b) => b.amount - a.amount)[0] || null;

  // What's about to be charged — the thing most worth knowing on opening
  const outstanding = (sched?.entries || []).filter(e => e.status !== 'paid');
  const soon = outstanding
    .filter(e => e.date && (e.date - now) <= 7 * DAY && (e.date - now) >= -DAY)
    .sort((a, b) => a.date - b.date);
  const soonTotal = soon.reduce((a, e) => a + e.amount, 0);
  const overdueTotal = (carriedOver || []).reduce((a, e) => a + e.amount, 0);

  // Goals: closest to finishing, since that's the motivating one
  const goalRows = (goals || []).map(g => {
    const bal = Number(g.currentBalance) || 0;
    const target = Number(g.target) || 0;
    return { label: g.label, balance: bal, target,
             pct: target > 0 ? Math.min((bal / target) * 100, 100) : null };
  }).filter(g => g.target > 0);
  const closestGoal = goalRows.slice().sort((a, b) => b.pct - a.pct)[0] || null;

  // Things worth flagging rather than burying
  const notes = [];
  const unattributed = perPerson.unattributed || 0;
  if (unattributed > 0) notes.push(`${fmt(unattributed)} of this week's spending isn't attributed to either of you`);
  if (overdueTotal > 0) notes.push(`${fmt(overdueTotal)} in bills is still overdue from an earlier month`);
  if (availableMoney < 0) notes.push(`available money is currently negative (${fmt(availableMoney)})`);

  return {
    myName: me, partnerName: them,
    weekTotal, weekCount: week.length, perPerson,
    topCategory: topCategory ? { category: topCategory[0], amount: topCategory[1] } : null,
    biggest: biggest ? { label: biggest.description || biggest.merchant || biggest.note || 'a purchase',
                         amount: biggest.amount, who: first(biggest.who) || null } : null,
    upcoming: soon.slice(0, 4).map(e => ({ label: e.label, amount: e.amount,
      inDays: Math.max(0, Math.round((e.date - now) / DAY)) })),
    upcomingTotal: soonTotal,
    overdueTotal,
    availableMoney,
    closestGoal,
    notes,
    hasAnything: week.length > 0 || soon.length > 0 || overdueTotal > 0,
  };
}

/** Plain, honest summary used when Claude isn't reachable. */
export function fallbackBriefing(f) {
  const bits = [];
  if (f.weekCount > 0) {
    const who = Object.entries(f.perPerson).filter(([k]) => k !== 'unattributed')
      .sort((a, b) => b[1] - a[1]);
    bits.push(`${fmt(f.weekTotal)} went out over the last seven days across ${f.weekCount} transaction${f.weekCount === 1 ? '' : 's'}` +
      (who.length === 2 ? ` — ${cap(who[0][0])} ${fmt(who[0][1])}, ${cap(who[1][0])} ${fmt(who[1][1])}.` : '.'));
  } else {
    bits.push('Nothing has been recorded in the last seven days.');
  }
  if (f.upcomingTotal > 0) {
    bits.push(`${fmt(f.upcomingTotal)} in bills is due within the week${f.upcoming[0] ? `, starting with ${f.upcoming[0].label}` : ''}.`);
  }
  if (f.overdueTotal > 0) bits.push(`${fmt(f.overdueTotal)} is still overdue from an earlier month.`);
  if (f.closestGoal && f.closestGoal.pct != null) {
    bits.push(`${f.closestGoal.label} is ${Math.round(f.closestGoal.pct)}% funded.`);
  }
  return bits.join(' ');
}

/**
 * Ask Claude to write the briefing. The figures are supplied — the model is
 * asked to phrase them, never to compute or estimate anything, because a
 * financial summary that quietly invents a number is worse than no summary.
 */
export async function writeBriefing(facts, personName) {
  const fallback = fallbackBriefing(facts);
  try {
    const prompt = `You are writing a short "welcome back" note inside a shared household budgeting app, addressed to ${personName || 'one of the two partners'}.

Here are the ONLY facts you may use. Every number below is already correct — use them exactly as given, and never introduce a figure that is not here:

${JSON.stringify(facts, null, 2)}

Write 2-3 sentences, warm but matter-of-fact, that help them pick up where they left off. Prioritise: anything overdue or negative first, then what's due soon, then how the week went, then goal progress if there's room.

Rules:
- Never invent, estimate, or extrapolate a number.
- Don't moralise about their spending or tell them off.
- Don't open with "Welcome back" or "Hi" — go straight to the substance.
- Plain sentences. No bullet points, no headings, no emoji.
- If the facts show nothing much happened, say so briefly rather than padding.`;

    const res = await callClaude({
      model: MODEL_FAST,
      max_tokens: 220,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = (textOf(res) || '').trim();
    if (!text) return { text: fallback, source: 'rules' };
    return { text, source: 'ai' };
  } catch {
    return { text: fallback, source: 'rules' };
  }
}
