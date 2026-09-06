/**
 * Weekly spending summary — emailed to every member of every household.
 *
 * This is a Netlify Scheduled Function: the cron lives in `config.schedule`
 * at the bottom, so no external scheduler is needed. Netlify runs it.
 *
 * The important difference from send-weekly-summary.js: that one is handed
 * its numbers in the request body by the browser, which only works while
 * someone has the app open. On a schedule nobody is looking at anything, so
 * this function queries Supabase itself using the service-role key and works
 * out the figures server-side.
 *
 * Required environment variables (Netlify → Site settings → Environment):
 *   SUPABASE_URL               your project URL
 *   SUPABASE_SERVICE_ROLE_KEY  service_role key (NOT the anon key — this
 *                              bypasses row-level security, which is exactly
 *                              why it must never be exposed to the browser)
 *   BREVO_EMAIL                the address Brevo sends from
 *   BREVO_API_KEY              Brevo SMTP key
 */

import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

const money = n => '$' + Math.abs(Number(n) || 0).toLocaleString('en-CA',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s == null ? '' : s)
  .replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
const firstName = s => String(s || '').trim().split(/\s+/)[0].toLowerCase();

// Never counted as spending — see the app's own ALWAYS_EXCLUDED_CATS
const EXCLUDED = new Set(['income', 'cc_payment', 'transfer', '_skip']);

export default async function handler() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BREVO_EMAIL, BREVO_API_KEY } = process.env;

  const missing = Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BREVO_EMAIL, BREVO_API_KEY })
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    console.error('weekly-summary: missing env vars:', missing.join(', '));
    return new Response(JSON.stringify({ error: 'Missing env vars: ' + missing.join(', ') }), { status: 500 });
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const now = new Date();
  const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7);
  const iso = d => d.toISOString().slice(0, 10);
  const from = iso(weekAgo), to = iso(now);

  try {
    // Who to email: every member of every household, with their address.
    const { data: members, error: mErr } = await db.from('household_members').select('user_id, household_id');
    if (mErr) throw mErr;
    if (!members?.length) {
      return new Response(JSON.stringify({ sent: 0, note: 'no households yet' }), { status: 200 });
    }

    const { data: userList, error: uErr } = await db.auth.admin.listUsers({ perPage: 1000 });
    if (uErr) throw uErr;
    const userById = new Map((userList?.users || []).map(u => [u.id, u]));

    // Group members into their households
    const households = new Map();
    for (const m of members) {
      if (!households.has(m.household_id)) households.set(m.household_id, []);
      households.get(m.household_id).push(m.user_id);
    }

    const transport = nodemailer.createTransport({
      host: 'smtp-relay.brevo.com', port: 587, secure: false,
      auth: { user: BREVO_EMAIL, pass: BREVO_API_KEY },
    });

    let sent = 0, skipped = 0;
    const results = [];

    for (const [householdId, userIds] of households) {
      const recipients = userIds.map(id => userById.get(id))
        .filter(u => u?.email).map(u => ({ email: u.email, name: u.user_metadata?.name || '' }));
      if (!recipients.length) { skipped++; continue; }

      const summary = await buildWeekSummary(db, householdId, from, to, recipients);

      // Nothing happened this week — don't send a mail saying nothing happened.
      if (summary.txCount === 0 && summary.billsPaid === 0) {
        results.push({ householdId, skipped: 'no activity' });
        skipped++;
        continue;
      }

      const html = renderEmail(summary, from, to);
      await transport.sendMail({
        from: `"Budget For Two" <${BREVO_EMAIL}>`,
        to: recipients.map(r => r.email).join(', '),   // both partners, one email
        subject: `Your week: ${money(summary.totalSpent)} spent · ${from} to ${to}`,
        html,
      });
      sent++;
      results.push({ householdId, to: recipients.map(r => r.email), spent: summary.totalSpent });
    }

    console.log('weekly-summary:', JSON.stringify({ sent, skipped, results }));
    return new Response(JSON.stringify({ sent, skipped, results }), { status: 200 });
  } catch (err) {
    console.error('weekly-summary failed:', err);
    return new Response(JSON.stringify({ error: err.message || String(err) }), { status: 500 });
  }
}

async function buildWeekSummary(db, householdId, from, to, recipients) {
  const scoped = table => db.from(table).select('*').eq('household_id', householdId);

  const [txRes, biRes, bpRes] = await Promise.all([
    scoped('transactions').gte('date', from).lte('date', to),
    scoped('bank_imports').gte('date', from).lte('date', to),
    scoped('bill_payments').gte('paid_at', from + 'T00:00:00.000Z'),
  ]);

  const all = [...(txRes.data || []), ...(biRes.data || [])];
  const spend = all.filter(t => !EXCLUDED.has(t.category || t.cat) && (t.amount || 0) > 0);
  const income = all.filter(t => (t.category || t.cat) === 'income');

  // Per person, using the same "who" attribution the app uses everywhere
  const perPerson = {};
  for (const t of spend) {
    const k = firstName(t.who) || 'unattributed';
    perPerson[k] = (perPerson[k] || 0) + t.amount;
  }

  const byCat = {};
  for (const t of spend) {
    const c = t.category || t.cat || 'other';
    byCat[c] = (byCat[c] || 0) + t.amount;
  }

  const bills = bpRes.data || [];
  const billsByPayer = {};
  for (const b of bills) {
    const k = firstName(b.paid_by) || 'unattributed';
    billsByPayer[k] = (billsByPayer[k] || 0) + (b.amount || 0);
  }

  return {
    householdId,
    recipients,
    txCount: spend.length,
    totalSpent: spend.reduce((a, t) => a + t.amount, 0),
    totalIncome: income.reduce((a, t) => a + t.amount, 0),
    billsPaid: bills.reduce((a, b) => a + (b.amount || 0), 0),
    billCount: bills.length,
    perPerson,
    billsByPayer,
    categories: Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 8),
    biggest: spend.slice().sort((a, b) => b.amount - a.amount).slice(0, 5),
  };
}

function renderEmail(s, from, to) {
  const person = Object.entries(s.perPerson).sort((a, b) => b[1] - a[1]);
  const row = (l, v, muted) =>
    `<tr><td style="padding:7px 0;border-bottom:1px solid #f0efed;${muted ? 'color:#8a8a84;' : ''}">${esc(l)}</td>
     <td style="padding:7px 0;border-bottom:1px solid #f0efed;text-align:right;font-variant-numeric:tabular-nums">${money(v)}</td></tr>`;

  return `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f5f3ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif;color:#1a1a18">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden">

  <div style="background:#1a7a4a;padding:22px 24px">
    <p style="margin:0;color:rgba(255,255,255,.75);font-size:11px;letter-spacing:.1em;text-transform:uppercase">Your week · ${esc(from)} to ${esc(to)}</p>
    <p style="margin:6px 0 0;color:#fff;font-size:32px;font-weight:600">${money(s.totalSpent)}</p>
    <p style="margin:2px 0 0;color:rgba(255,255,255,.8);font-size:13px">across ${s.txCount} transaction${s.txCount === 1 ? '' : 's'}</p>
  </div>

  <div style="padding:20px 24px">

    <h3 style="margin:0 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:#57534e">Who spent what</h3>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      ${person.length
        ? person.map(([k, v]) => row(k === 'unattributed' ? 'Not attributed to anyone' : cap(k), v, k === 'unattributed')).join('')
        : '<tr><td style="padding:7px 0;color:#8a8a84">No spending this week.</td></tr>'}
    </table>

    ${s.billCount ? `
    <h3 style="margin:22px 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:#57534e">Bills paid</h3>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      ${Object.entries(s.billsByPayer).map(([k, v]) =>
        row(k === 'unattributed' ? 'Matched from a statement' : cap(k) + ' paid', v, k === 'unattributed')).join('')}
      ${row('Total', s.billsPaid)}
    </table>` : ''}

    <h3 style="margin:22px 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:#57534e">Where it went</h3>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      ${s.categories.length ? s.categories.map(([c, v]) => row(c, v)).join('')
        : '<tr><td style="padding:7px 0;color:#8a8a84">Nothing categorised yet.</td></tr>'}
    </table>

    ${s.biggest.length ? `
    <h3 style="margin:22px 0 8px;font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:#57534e">Biggest this week</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      ${s.biggest.map(t => `<tr>
        <td style="padding:6px 0;border-bottom:1px solid #f0efed">${esc(t.description || t.merchant || t.note || 'Transaction')}
          <span style="color:#8a8a84">· ${esc(cap(firstName(t.who)) || '—')}</span></td>
        <td style="padding:6px 0;border-bottom:1px solid #f0efed;text-align:right">${money(t.amount)}</td></tr>`).join('')}
    </table>` : ''}

    ${s.totalIncome ? `<p style="margin:20px 0 0;font-size:13px;color:#57534e">${money(s.totalIncome)} came in this week.</p>` : ''}

    <a href="https://budgetfortwo.netlify.app" style="display:block;margin:22px 0 0;background:#1a7a4a;color:#fff;text-decoration:none;text-align:center;padding:13px;border-radius:10px;font-weight:600;font-size:14px">Open Budget For Two</a>

    <p style="margin:18px 0 0;font-size:11px;color:#8a8a84;line-height:1.6">
      Sent to both of you every Friday. Figures cover ${esc(from)} to ${esc(to)} and reflect what's
      been recorded in the app — anything not yet imported or entered won't appear here.
    </p>
  </div>
</div></body></html>`;
}

// Fridays at 9am Eastern (13:00 UTC). Netlify runs this — no external
// scheduler needed. Cron is always UTC, so this shifts by an hour with
// daylight saving; 13:00 UTC is 9am EDT in summer, 8am EST in winter.
export const config = { schedule: '0 13 * * 5' };
