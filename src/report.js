/**
 * Monthly report builder.
 *
 * Pure data in, structured data out — no DOM, no formatting — so the
 * numbers can be tested directly. Rendering lives in renderMonthlyReportHtml
 * below and does no arithmetic of its own.
 *
 * The old export was three summary cards plus `txns.slice(0, 20)`: an
 * arbitrary handful of recent rows, with a "Total Spent" that didn't even
 * exclude income. This answers the questions a household actually has at
 * month end — what did each of us spend, who paid which bills, how much
 * did we shuffle between each other, and where did the cash go.
 */

const EXCLUDED = new Set(['income', 'cc_payment', 'transfer', '_skip']);
const money = n => '$' + Math.abs(Number(n) || 0).toLocaleString('en-CA',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });


const norm = s => String(s || '').toLowerCase();
export const firstNameOf = s => String(s || '').trim().split(/\s+/)[0].toLowerCase();

/** Does this transaction's description name the given person? Bank
 *  descriptions are messy ("INTERAC ETRNSFR SENT MARIEL KO", "AD RECVD
 *  NESS MARIEL KO"), so match on the first name, which is the part that
 *  stays stable across both wordings. */
export function describesPerson(description, fullName) {
  const first = firstNameOf(fullName);
  if (!first || first.length < 3) return false;
  return norm(description).includes(first);
}

/** Cash leaving the account as cash — the money that then gets spent with
 *  no record at all, so the report can flag it for attribution rather than
 *  quietly letting it vanish into "other". */
export function isCashWithdrawal(t) {
  const d = norm(t.description || t.note || t.merchant);
  return /\b(atm|abm|cash withdrawal|withdrawal|cash advance|interac cash)\b/.test(d);
}

/** A transfer between the two partners, in either direction. These are not
 *  spending — the money never left the household — so counting them as
 *  spending would double-count whatever it was later spent on. */
export function isInterPartnerTransfer(t, myName, partnerName) {
  const d = norm(t.description || t.note || t.merchant);
  if (!/e-?transfer|etrnsfr|interac|transfer|sent|recvd|received/.test(d)) return false;
  return describesPerson(d, myName) || describesPerson(d, partnerName);
}

function isSpend(t) {
  const cat = t.category || t.cat;
  return !EXCLUDED.has(cat) && (t.amount || 0) > 0;
}

/**
 * @param opts.txns/bankImports  this month's transactions
 * @param opts.billEntries       schedule entries (need .label .amount .status .tickedBy)
 * @param opts.allCats           category definitions, for labels
 */
export function buildMonthlyReport({
  year, month, txns = [], bankImports = [], billEntries = [],
  myName = '', partnerName = '', allCats = [], catTargets = {}, goals = [],
}) {
  const all = [...txns, ...bankImports];
  const catLabel = id => (allCats.find(c => c.id === id) || {}).label || id || 'Uncategorised';

  const me = firstNameOf(myName) || 'me';
  const them = firstNameOf(partnerName) || 'partner';
  const whoOf = t => firstNameOf(t.who) || null;

  // ── Spending, per person ────────────────────────────────────────────────
  const spend = all.filter(isSpend);
  const perPerson = {};
  const addTo = (key, t) => {
    if (!perPerson[key]) perPerson[key] = { total: 0, count: 0, byCategory: {} };
    const p = perPerson[key];
    p.total += t.amount; p.count += 1;
    const c = t.category || t.cat;
    p.byCategory[c] = (p.byCategory[c] || 0) + t.amount;
  };
  spend.forEach(t => addTo(whoOf(t) || 'unattributed', t));

  const totalSpent = spend.reduce((a, t) => a + t.amount, 0);

  // ── Income, per person ──────────────────────────────────────────────────
  const incomeRows = all.filter(t => (t.category || t.cat) === 'income');
  const incomeByPerson = {};
  incomeRows.forEach(t => {
    const k = whoOf(t) || 'unattributed';
    incomeByPerson[k] = (incomeByPerson[k] || 0) + t.amount;
  });
  const totalIncome = incomeRows.reduce((a, t) => a + t.amount, 0);

  // ── Bills, and who actually paid them ───────────────────────────────────
  const paidBills = billEntries.filter(b => b.status === 'paid');
  const billsByPayer = {};
  paidBills.forEach(b => {
    const k = firstNameOf(b.tickedBy) || 'unattributed';
    if (!billsByPayer[k]) billsByPayer[k] = { total: 0, bills: [] };
    billsByPayer[k].total += b.amount;
    billsByPayer[k].bills.push({ label: b.label, amount: b.amount });
  });
  const billsPaidTotal = paidBills.reduce((a, b) => a + b.amount, 0);
  const billsOutstanding = billEntries.filter(b => b.status !== 'paid');
  const billsOutstandingTotal = billsOutstanding.reduce((a, b) => a + b.amount, 0);

  // ── Money moved between the two of you ──────────────────────────────────
  const transfers = all
    .filter(t => isInterPartnerTransfer(t, myName, partnerName))
    .map(t => {
      const d = norm(t.description || t.note || t.merchant);
      const incoming = /recvd|received|deposit|\bin\b/.test(d) || (t.direction === 'credit');
      return {
        date: t.date, description: t.description || t.note || t.merchant || 'Transfer',
        amount: Math.abs(t.amount || 0),
        direction: incoming ? 'in' : 'out',
      };
    })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const transferIn  = transfers.filter(t => t.direction === 'in').reduce((a, t) => a + t.amount, 0);
  const transferOut = transfers.filter(t => t.direction === 'out').reduce((a, t) => a + t.amount, 0);

  // ── Cash out of the account ─────────────────────────────────────────────
  const cash = all.filter(isCashWithdrawal).map(t => ({
    date: t.date,
    description: t.description || t.note || t.merchant || 'Withdrawal',
    amount: Math.abs(t.amount || 0),
    who: whoOf(t),
  })).sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const cashTotal = cash.reduce((a, t) => a + t.amount, 0);
  const cashUnattributed = cash.filter(c => !c.who).reduce((a, c) => a + c.amount, 0);

  // ── Category totals across the household ────────────────────────────────
  const byCategory = {};
  spend.forEach(t => {
    const c = t.category || t.cat;
    byCategory[c] = (byCategory[c] || 0) + t.amount;
  });
  const categories = Object.entries(byCategory)
    .map(([id, amount]) => ({ id, label: catLabel(id), amount,
      pct: totalSpent > 0 ? (amount / totalSpent) * 100 : 0 }))
    .sort((a, b) => b.amount - a.amount);

  // ── How we're doing against our own targets ─────────────────────────────
  // Deliberately NOT a per-person comparison. An earlier version totalled
  // each partner's spending plus bills and named whoever "carried more" —
  // which reads as a scoreboard and invites resentment rather than a useful
  // conversation. What's actually actionable is where the household as a
  // whole went over what it meant to spend, and whether the shared goals
  // moved. Both are things the two of you can act on together.
  const budgets = (allCats || [])
    .filter(c => !EXCLUDED.has(c.id) && !c.excluded)
    .map(c => {
      const target = Number(catTargets?.[c.id] ?? c.target ?? 0);
      const spent = byCategory[c.id] || 0;
      return { id: c.id, label: c.label || c.id, target, spent,
               over: target > 0 ? spent - target : 0,
               pct: target > 0 ? (spent / target) * 100 : null };
    })
    .filter(c => c.target > 0);

  const overBudget = budgets.filter(c => c.spent > c.target)
    .sort((a, b) => b.over - a.over);
  const underBudget = budgets.filter(c => c.spent <= c.target && c.spent > 0)
    .sort((a, b) => (a.target - a.spent) - (b.target - b.spent));
  const totalBudget = budgets.reduce((a, c) => a + c.target, 0);
  const totalAgainstBudget = budgets.reduce((a, c) => a + c.spent, 0);
  const overallOver = totalAgainstBudget - totalBudget;

  // Goals — shared progress, since these are the thing worth celebrating
  const goalProgress = (goals || []).map(g => {
    const bal = Number(g.currentBalance) || 0;
    const target = Number(g.target) || 0;
    const thisMonth = (g.deposits || [])
      .filter(d => {
        const dt = String(d.date || '');
        return dt.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`);
      })
      .reduce((a, d) => a + (Number(d.amount) || 0), 0);
    return { label: g.label, balance: bal, target, addedThisMonth: thisMonth,
             pct: target > 0 ? Math.min((bal / target) * 100, 100) : null,
             remaining: target > 0 ? Math.max(target - bal, 0) : null };
  });
  const goalsFunded = goalProgress.reduce((a, g) => a + g.addedThisMonth, 0);

  // Practical, specific suggestions — tied to the actual numbers, never
  // scolding, and never about who spent it.
  const suggestions = [];
  overBudget.slice(0, 3).forEach(c => {
    const weekly = c.over / 4.3;
    suggestions.push(
      `${c.label} came in ${money(c.over)} over the ${money(c.target)} you'd set. ` +
      `Trimming about ${money(weekly)} a week would bring it back in line — ` +
      `or the target may simply be lower than what this category realistically costs, which is worth a look too.`
    );
  });
  if (overallOver > 0 && overBudget.length > 1) {
    suggestions.push(
      `Across all categories you're ${money(overallOver)} over the ${money(totalBudget)} budgeted. ` +
      `The single biggest gap is ${overBudget[0].label} — starting there covers ${Math.round((overBudget[0].over / overallOver) * 100)}% of it.`
    );
  }
  if (underBudget.length && overBudget.length) {
    const room = underBudget.reduce((a, c) => a + (c.target - c.spent), 0);
    if (room > 0) suggestions.push(
      `There's ${money(room)} unspent across ${underBudget.length} other categor${underBudget.length === 1 ? 'y' : 'ies'}, ` +
      `so the household total may be closer to plan than any single category suggests.`
    );
  }
  if (goalsFunded > 0) {
    suggestions.push(`You put ${money(goalsFunded)} towards your goals this month.`);
  } else if (goalProgress.length) {
    suggestions.push(
      `No goal deposits went in this month. Even a small standing amount tends to work better than waiting for a surplus that never quite arrives.`
    );
  }

  return {
    year, month, myName, partnerName, me, them,
    totals: {
      income: totalIncome, spent: totalSpent,
      billsPaid: billsPaidTotal, billsOutstanding: billsOutstandingTotal,
      transactionCount: all.length,
    },
    perPerson, incomeByPerson, categories,
    bills: { byPayer: billsByPayer, paidCount: paidBills.length,
             outstanding: billsOutstanding.map(b => ({ label: b.label, amount: b.amount })) },
    transfers: { rows: transfers, in: transferIn, out: transferOut, net: transferIn - transferOut },
    cash: { rows: cash, total: cashTotal, unattributed: cashUnattributed },
    budgets: { rows: budgets, over: overBudget, under: underBudget,
               totalBudget, totalSpent: totalAgainstBudget, overallOver },
    goalProgress, goalsFunded, suggestions,
    unattributedSpend: perPerson.unattributed?.total || 0,
  };
}

// ─── Rendering ────────────────────────────────────────────────────────────────
const MONTH_NAMES = ['January','February','March','April','May','June',
  'July','August','September','October','November','December'];

const esc = s => String(s == null ? '' : s)
  .replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';

export function renderMonthlyReportHtml(r) {
  const label = `${MONTH_NAMES[r.month]} ${r.year}`;
  const people = Object.keys(r.perPerson);

  const personCards = people.map(k => {
    const p = r.perPerson[k];
    const cats = Object.entries(p.byCategory).sort((a,b)=>b[1]-a[1]).slice(0,5);
    return `<div class="card">
      <h3>${esc(k === 'unattributed' ? 'Not attributed to anyone' : cap(k))}</h3>
      <p class="big">${money(p.total)}</p>
      <p class="sub">${p.count} transaction${p.count===1?'':'s'}${
        r.incomeByPerson[k] ? ` · income ${money(r.incomeByPerson[k])}` : ''}</p>
      <ul>${cats.map(([c,a])=>`<li><span>${esc(c)}</span><span>${money(a)}</span></li>`).join('')}</ul>
    </div>`;
  }).join('');

  const billPayerRows = Object.entries(r.bills.byPayer).map(([k,v]) =>
    `<tr><td>${esc(k==='unattributed'?'Matched from a statement (no payer recorded)':cap(k))}</td>
     <td>${v.bills.length}</td><td class="r">${money(v.total)}</td>
     <td class="muted">${esc(v.bills.map(b=>b.label).join(', '))}</td></tr>`).join('')
    || `<tr><td colspan="4" class="muted">No bills marked paid this month.</td></tr>`;

  const transferRows = r.transfers.rows.map(t =>
    `<tr><td>${esc(t.date)}</td><td>${esc(t.description)}</td>
     <td class="r ${t.direction==='in'?'in':'out'}">${t.direction==='in'?'+':'−'}${money(t.amount)}</td></tr>`).join('')
    || `<tr><td colspan="3" class="muted">No transfers between you this month.</td></tr>`;

  const cashRows = r.cash.rows.map(c =>
    `<tr><td>${esc(c.date)}</td><td>${esc(c.description)}</td>
     <td class="r">${money(c.amount)}</td>
     <td>${c.who ? esc(cap(c.who)) : '<span class="flag">needs attributing</span>'}</td></tr>`).join('')
    || `<tr><td colspan="4" class="muted">No cash withdrawals this month.</td></tr>`;

  const catRows = r.categories.map(c =>
    `<tr><td>${esc(c.label)}</td><td class="r">${money(c.amount)}</td>
     <td class="r muted">${c.pct.toFixed(1)}%</td></tr>`).join('')
    || `<tr><td colspan="3" class="muted">No spending recorded.</td></tr>`;

  const outstandingNote = r.bills.outstanding.length
    ? `<p class="note"><b>${r.bills.outstanding.length} bill${r.bills.outstanding.length===1?'':'s'} still unpaid</b>
       (${money(r.totals.billsOutstanding)}): ${esc(r.bills.outstanding.map(b=>b.label).join(', '))}.</p>` : '';

  const warnings = [];
  if (r.unattributedSpend > 0) warnings.push(
    `${money(r.unattributedSpend)} of spending isn't attributed to either of you — most likely an imported statement where "whose spending is this" wasn't set.`);
  if (r.cash.unattributed > 0) warnings.push(
    `${money(r.cash.unattributed)} was withdrawn as cash with no record of who spent it. Cash leaves no trail, so it has to be assigned by hand.`);
  if (Object.keys(r.bills.byPayer).includes('unattributed')) warnings.push(
    `Some bills were matched automatically from a statement, so no payer was recorded for them.`);

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Budget For Two — ${esc(label)}</title>
<style>
 body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:40px;color:#1a1a18;max-width:900px;margin:0 auto;line-height:1.5}
 h1{margin:0 0 4px;font-size:28px}h2{font-size:15px;margin:36px 0 10px;text-transform:uppercase;letter-spacing:.08em;color:#57534e;border-bottom:2px solid #1a1a18;padding-bottom:6px}
 h3{margin:0 0 6px;font-size:14px}
 .date{color:#78716c;font-size:14px;margin:0 0 28px}
 .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px}
 .card{border:1px solid #e7e5e4;border-radius:10px;padding:14px}
 .big{font-size:24px;font-weight:600;margin:0;color:#1a7a4a}
 .sub{font-size:12px;color:#78716c;margin:2px 0 8px}
 .card ul{list-style:none;padding:0;margin:0;font-size:12px}
 .card li{display:flex;justify-content:space-between;padding:2px 0;color:#57534e}
 table{width:100%;border-collapse:collapse;font-size:13px}
 th{text-align:left;padding:7px 6px;font-size:11px;color:#78716c;border-bottom:1px solid #ddd;text-transform:uppercase;letter-spacing:.04em}
 td{padding:7px 6px;border-bottom:1px solid #f0efed;vertical-align:top}
 .r{text-align:right;font-variant-numeric:tabular-nums}
 .muted{color:#8a8a84;font-size:12px}
 .in{color:#1a7a4a}.out{color:#c0392b}
 .flag{color:#b45309;font-weight:600;font-size:11px}
 .note{background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:10px 12px;font-size:12px;color:#92400e;margin:10px 0}
 .warn{background:#fdf0ee;border:1px solid #f5c6ba;border-radius:8px;padding:12px 14px;margin:10px 0}
 .warn li{font-size:12px;color:#9b2c2c;margin:4px 0}
 .totals p{display:flex;justify-content:space-between;margin:5px 0;font-size:14px}
 .totals .grand{font-weight:700;font-size:17px;border-top:2px solid #1a1a18;padding-top:8px;margin-top:8px}
 @media print{body{padding:0}h2{page-break-after:avoid}table{page-break-inside:avoid}}
</style></head><body>

<h1>Budget For Two</h1>
<p class="date">${esc(label)} · full monthly summary · generated ${esc(new Date().toLocaleDateString('en-CA'))}</p>

<h2>The month at a glance</h2>
<div class="totals">
 <p><span>Income received</span><span>${money(r.totals.income)}</span></p>
 <p><span>Everyday spending</span><span>${money(r.totals.spent)}</span></p>
 <p><span>Bills paid</span><span>${money(r.totals.billsPaid)}</span></p>
 <p><span>Bills still outstanding</span><span>${money(r.totals.billsOutstanding)}</span></p>
 <p class="grand"><span>Left over (income − spending − bills paid)</span><span>${money(r.totals.income - r.totals.spent - r.totals.billsPaid)}</span></p>
</div>
${outstandingNote}

<h2>What each of you spent</h2>
<div class="grid">${personCards || '<p class="muted">No spending recorded.</p>'}</div>

<h2>Who paid which bills</h2>
<table><thead><tr><th>Paid by</th><th>Bills</th><th class="r">Total</th><th>Which ones</th></tr></thead>
<tbody>${billPayerRows}</tbody></table>

<h2>Money moved between you</h2>
<p class="muted">Transfers between the two of you are not spending — the money never left the household. Listed here so it's visible, and deliberately excluded from every total above.</p>
<table><thead><tr><th>Date</th><th>Description</th><th class="r">Amount</th></tr></thead>
<tbody>${transferRows}</tbody></table>
<div class="totals" style="margin-top:8px">
 <p><span>Received</span><span class="in">${money(r.transfers.in)}</span></p>
 <p><span>Sent</span><span class="out">${money(r.transfers.out)}</span></p>
 <p class="grand"><span>Net</span><span>${r.transfers.net >= 0 ? '+' : '−'}${money(r.transfers.net)}</span></p>
</div>

<h2>Cash withdrawn</h2>
<p class="muted">Cash leaves no record of where it was spent, so it has to be assigned by hand.</p>
<table><thead><tr><th>Date</th><th>Description</th><th class="r">Amount</th><th>Spent by</th></tr></thead>
<tbody>${cashRows}</tbody></table>
${r.cash.total ? `<p class="note">${money(r.cash.total)} withdrawn as cash this month${
  r.cash.unattributed ? `, of which ${money(r.cash.unattributed)} has no one assigned to it` : ''}.</p>` : ''}

<h2>Where the money went</h2>
<table><thead><tr><th>Category</th><th class="r">Amount</th><th class="r">Share</th></tr></thead>
<tbody>${catRows}</tbody></table>

<h2>How we did against our budget</h2>
${r.budgets.rows.length ? `
<table><thead><tr><th>Category</th><th class="r">Budgeted</th><th class="r">Spent</th><th class="r">Difference</th></tr></thead>
<tbody>${r.budgets.rows.slice().sort((a,b)=>b.over-a.over).map(c=>`<tr>
  <td>${esc(c.label)}</td><td class="r">${money(c.target)}</td><td class="r">${money(c.spent)}</td>
  <td class="r" style="color:${c.spent > c.target ? '#c0392b' : '#1a7a4a'}">${
    c.spent > c.target ? '+' + money(c.over) + ' over' : money(c.target - c.spent) + ' left'}</td></tr>`).join('')}
</tbody></table>
<div class="totals" style="margin-top:8px">
  <p class="grand"><span>All categories</span><span style="color:${r.budgets.overallOver > 0 ? '#c0392b' : '#1a7a4a'}">${
    r.budgets.overallOver > 0
      ? money(r.budgets.overallOver) + ' over budget'
      : money(-r.budgets.overallOver) + ' under budget'}</span></p>
</div>` : '<p class="muted">No category budgets set yet — add targets in Charges and this section will track them.</p>'}

<h2>Our goals</h2>
${r.goalProgress.length ? `
<table><thead><tr><th>Goal</th><th class="r">Saved</th><th class="r">Target</th><th class="r">Added this month</th></tr></thead>
<tbody>${r.goalProgress.map(g=>`<tr>
  <td>${esc(g.label)}${g.pct != null ? ` <span class="muted">${Math.round(g.pct)}%</span>` : ''}</td>
  <td class="r">${money(g.balance)}</td>
  <td class="r">${g.target ? money(g.target) : '—'}</td>
  <td class="r" style="${g.addedThisMonth > 0 ? 'color:#1a7a4a;font-weight:600' : 'color:#8a8a84'}">${
    g.addedThisMonth > 0 ? '+' + money(g.addedThisMonth) : '—'}</td></tr>`).join('')}
</tbody></table>
${r.goalsFunded > 0 ? `<p class="note" style="background:#e8f4ee;border-color:#1a7a4a44;color:#14603a">
  <b>${money(r.goalsFunded)} went towards your goals this month.</b></p>` : ''}`
: '<p class="muted">No goals set up yet.</p>'}

${r.suggestions.length ? `
<h2>Things you might try</h2>
<ul style="padding-left:18px;margin:8px 0">
${r.suggestions.map(t=>`<li style="font-size:13px;margin:7px 0;line-height:1.6">${esc(t)}</li>`).join('')}
</ul>
<p class="muted" style="margin-top:10px">These look at the household's spending as a whole, not at either of you individually.</p>` : ''}

${warnings.length ? `<h2>Worth checking</h2><div class="warn"><ul>${
  warnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul></div>` : ''}

<p class="muted" style="margin-top:36px">Generated by Budget For Two. Figures cover ${esc(label)} only, and reflect what was recorded in the app — anything not imported or entered won't appear here.</p>
</body></html>`;
}
