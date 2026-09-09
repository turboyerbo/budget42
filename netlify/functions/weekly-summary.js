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
 * EMAIL SETUP — two values, that's the whole thing.
 *
 *   GMAIL_USER            your.name@gmail.com
 *   GMAIL_APP_PASSWORD    16-character App Password from Google
 *                         (Google account password will NOT work)
 *
 * Plus, so the function can read the data:
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   (service_role, never the anon key)
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


/**
 * Gmail SMTP config. Two environment variables and nothing else — no sender
 * verification, no domain, no DNS records. Returns null if unset so the
 * caller can say plainly what's missing.
 */
export function resolveMailConfig(env) {
  if (!env.GMAIL_USER || !env.GMAIL_APP_PASSWORD) return null;
  return {
    from: env.GMAIL_USER,
    transport: {
      host: 'smtp.gmail.com', port: 587, secure: false,
      // Must be an App Password, not the account password. Google shows it
      // in groups of four, so spaces get stripped rather than causing a
      // baffling authentication failure.
      auth: {
        user: env.GMAIL_USER,
        pass: String(env.GMAIL_APP_PASSWORD).replace(/\s+/g, ''),
      },
    },
  };
}

export default async function handler() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

  const mail = resolveMailConfig(process.env);
  const problems = [];
  if (!SUPABASE_URL) problems.push('SUPABASE_URL');
  if (!SUPABASE_SERVICE_ROLE_KEY) problems.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!mail) problems.push('GMAIL_USER and GMAIL_APP_PASSWORD');
  if (problems.length) {
    const msg = 'Not configured yet — missing: ' + problems.join(', ');
    console.error('weekly-summary:', msg);
    return new Response(JSON.stringify({ ok: false, error: msg }), { status: 500 });
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const now = new Date();
  const weekAgo = new Date(now); weekAgo.setDate(now.getDate() - 7);
  const iso = d => d.toISOString().slice(0, 10);
  const from = iso(weekAgo), to = iso(now);

  try {
    // Who to email: every member of every household, with their address.
    // Households only exist once SECURITY_FIX_MIGRATION.sql has been run.
    // Before that, everyone shares one dataset anyway, so treat all users as
    // a single household rather than refusing to send — the email working
    // shouldn't be gated on an unrelated migration.
    let members = [];
    const { data: mData, error: mErr } = await db.from('household_members').select('user_id, household_id');
    if (mErr) {
      console.warn('weekly-summary: household_members unavailable, treating all users as one household:', mErr.message);
    } else {
      members = mData || [];
    }

    const { data: userList, error: uErr } = await db.auth.admin.listUsers({ perPage: 1000 });
    if (uErr) throw uErr;
    const allUsers = userList?.users || [];
    const userById = new Map(allUsers.map(u => [u.id, u]));

    if (!members.length) {
      if (!allUsers.length) {
        return new Response(JSON.stringify({ ok: true, sent: 0, note: 'no registered users yet' }), { status: 200 });
      }
      members = allUsers.map(u => ({ user_id: u.id, household_id: 'all-users' }));
    }

    // Group members into their households
    const households = new Map();
    for (const m of members) {
      if (!households.has(m.household_id)) households.set(m.household_id, []);
      households.get(m.household_id).push(m.user_id);
    }

    const transport = nodemailer.createTransport(mail.transport);

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
        from: `"Budget For Two" <${mail.from}>`,
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
  // 'all-users' is the pre-migration case: no household column to filter on
  // yet, so take everything rather than filtering on a column that may not
  // even exist.
  const scoped = table => householdId === 'all-users'
    ? db.from(table).select('*')
    : db.from(table).select('*').eq('household_id', householdId);

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
