/**
 * Nudges partners who were invited but haven't signed up yet.
 *
 * Runs daily; only actually emails an invite that has been waiting 3+ days
 * since the last contact, and gives up after 2 nudges. A reminder that keeps
 * arriving forever isn't a reminder, it's spam — and it reflects badly on
 * the person who sent the invite.
 */
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { resolveMailConfig } from './weekly-summary.js';
import { inviteEmail } from './send-invite.js';

const DAY = 86400000;
const WAIT_DAYS = 3;    // quiet period before the first nudge
const MAX_NUDGES = 2;   // then stop

export default async function handler() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  const mail = resolveMailConfig(process.env);
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !mail) {
    return new Response(JSON.stringify({ ok: false,
      error: 'Not configured — needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GMAIL_USER, GMAIL_APP_PASSWORD.' }),
      { status: 500 });
  }

  const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const now = Date.now();

  try {
    const { data: invites, error } = await db.from('household_invites')
      .select('*').eq('status', 'pending');
    if (error) {
      // Migration not run yet — nothing to do, and not an error worth alarming about.
      return new Response(JSON.stringify({ ok: true, nudged: 0, note: 'invites table not available yet' }), { status: 200 });
    }

    // Don't nudge someone who has since signed up under that address but
    // whose invite row was never marked accepted.
    const { data: userList } = await db.auth.admin.listUsers({ perPage: 1000 });
    const registered = new Set((userList?.users || []).map(u => (u.email || '').toLowerCase()));

    const transport = nodemailer.createTransport(mail.transport);
    let nudged = 0;
    const skipped = [];

    for (const inv of invites || []) {
      if (registered.has(String(inv.email).toLowerCase())) {
        await db.from('household_invites')
          .update({ status: 'accepted', accepted_at: new Date().toISOString() }).eq('id', inv.id);
        skipped.push({ email: inv.email, why: 'already signed up' });
        continue;
      }
      if ((inv.nudge_count || 0) >= MAX_NUDGES) { skipped.push({ email: inv.email, why: 'nudged enough' }); continue; }

      const since = new Date(inv.last_nudge_at || inv.created_at).getTime();
      const daysQuiet = Math.floor((now - since) / DAY);
      if (daysQuiet < WAIT_DAYS) { skipped.push({ email: inv.email, why: `only ${daysQuiet}d since last contact` }); continue; }

      const daysWaiting = Math.floor((now - new Date(inv.created_at).getTime()) / DAY);
      const { subject, html } = inviteEmail({
        name: inv.name, fromName: inv.invited_by, nudge: true, daysWaiting,
      });
      await transport.sendMail({ from: `"Budget For Two" <${mail.from}>`, to: inv.email, subject, html });
      await db.from('household_invites').update({
        last_nudge_at: new Date().toISOString(),
        nudge_count: (inv.nudge_count || 0) + 1,
      }).eq('id', inv.id);
      nudged++;
    }

    console.log('nudge-invites:', JSON.stringify({ nudged, skipped }));
    return new Response(JSON.stringify({ ok: true, nudged, skipped }), { status: 200 });
  } catch (err) {
    console.error('nudge-invites failed:', err);
    return new Response(JSON.stringify({ ok: false, error: err.message || String(err) }), { status: 500 });
  }
}

// Daily at 10am Eastern. The 3-day wait is enforced per-invite above, so
// running daily just means each invite is nudged promptly once it's due.
export const config = { schedule: '0 14 * * *' };
