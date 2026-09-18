/**
 * Sends a partner invitation. Called from the app when someone invites their
 * partner, and reused by the nudge job (nudge-invites.js) with nudge=true.
 *
 * Uses the same two Gmail variables as everything else — GMAIL_USER and
 * GMAIL_APP_PASSWORD.
 */
import nodemailer from 'nodemailer';
import { resolveMailConfig } from './weekly-summary.js';

const esc = s => String(s == null ? '' : s)
  .replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

const APP_URL = 'https://budgetfortwo.netlify.app';

export function inviteEmail({ name, fromName, nudge = false, daysWaiting = 0 }) {
  const who = esc(fromName || 'Your partner');
  const you = name ? esc(name) : 'there';

  const opening = nudge
    ? `${who} invited you to share a budget${daysWaiting ? ` ${daysWaiting} days ago` : ''}, and it's still waiting for you.`
    : `${who} would like to share a household budget with you on Budget For Two.`;

  const body = nudge
    ? `No rush — the invite doesn't expire. If now isn't the time, you can ignore this and ${who} will carry on tracking on their own.`
    : `You'll both see the same spending, bills and goals, and it stays clear who paid for what. Signing up takes about a minute.`;

  return {
    subject: nudge
      ? `Reminder: ${who} is waiting for you on Budget For Two`
      : `${who} invited you to Budget For Two`,
    html: `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f5f3ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif;color:#1a1a18">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden">
  <div style="background:#1a7a4a;padding:26px 24px;text-align:center">
    <p style="margin:0;color:#fff;font-size:22px;font-weight:600">Budget For Two</p>
  </div>
  <div style="padding:24px">
    <p style="margin:0 0 14px;font-size:15px">Hi ${you},</p>
    <p style="margin:0 0 14px;font-size:14px;line-height:1.65">${opening}</p>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.65;color:#57534e">${body}</p>
    <a href="${APP_URL}" style="display:block;background:#1a7a4a;color:#fff;text-decoration:none;text-align:center;padding:14px;border-radius:10px;font-weight:600;font-size:15px">Join ${who}</a>
    <p style="margin:18px 0 0;font-size:12px;color:#78716c;line-height:1.6">
      Sign up with <b>this email address</b> and you'll be connected automatically.
      Using a different address creates a separate budget instead.
    </p>
    <p style="margin:14px 0 0;font-size:11px;color:#8a8a84;line-height:1.6">
      If you weren't expecting this, you can ignore it — nothing has been shared with you.
    </p>
  </div>
</div></body></html>`,
  };
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }
  const mail = resolveMailConfig(process.env);
  if (!mail) {
    return { statusCode: 500, body: JSON.stringify({
      error: 'Email is not set up. Add GMAIL_USER and GMAIL_APP_PASSWORD in Netlify, then redeploy.' }) };
  }
  try {
    const { email, name, fromName, nudge, daysWaiting } = JSON.parse(event.body || '{}');
    if (!email) return { statusCode: 400, body: JSON.stringify({ error: 'No email address given.' }) };

    const { subject, html } = inviteEmail({ name, fromName, nudge, daysWaiting });
    await nodemailer.createTransport(mail.transport).sendMail({
      from: `"Budget For Two" <${mail.from}>`, to: email, subject, html,
    });
    return { statusCode: 200, body: JSON.stringify({ ok: true, sentTo: email, nudge: !!nudge }) };
  } catch (err) {
    console.error('send-invite failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || String(err) }) };
  }
};
