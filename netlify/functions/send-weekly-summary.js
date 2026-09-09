/**
 * Sends one summary email on demand — this is what the "Send Test Email"
 * button in Settings calls.
 *
 * Setup is two environment variables in Netlify:
 *   GMAIL_USER          your.name@gmail.com
 *   GMAIL_APP_PASSWORD  16-character App Password from Google
 *
 * The weekly automatic email is a different file (weekly-summary.js): it
 * runs on a schedule and fetches its own data, because on a schedule nobody
 * has the app open to supply it. This one is handed its numbers by the
 * browser, which is fine for a button press.
 */
import nodemailer from 'nodemailer';
import { resolveMailConfig } from './weekly-summary.js';

const money = n => '$' + Math.abs(Number(n) || 0).toLocaleString('en-CA',
  { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const esc = s => String(s == null ? '' : s)
  .replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const mail = resolveMailConfig(process.env);
  if (!mail) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'Email is not set up yet. Add GMAIL_USER and GMAIL_APP_PASSWORD in ' +
               'Netlify (Site configuration → Environment variables), then redeploy.',
      }),
    };
  }

  try {
    const { email, spending = {}, bills = {}, income = 0, startDate, endDate } = JSON.parse(event.body || '{}');
    if (!email) {
      return { statusCode: 400, body: JSON.stringify({ error: 'No recipient address was provided.' }) };
    }

    const transport = nodemailer.createTransport(mail.transport);

    const html = `<!DOCTYPE html><html><body style="margin:0;padding:24px;background:#f5f3ef;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,sans-serif;color:#1a1a18">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden">
  <div style="background:#1a7a4a;padding:22px 24px">
    <p style="margin:0;color:rgba(255,255,255,.75);font-size:11px;letter-spacing:.1em;text-transform:uppercase">
      ${esc(startDate || '')} — ${esc(endDate || '')}
    </p>
    <p style="margin:6px 0 0;color:#fff;font-size:32px;font-weight:600">${money(spending.total)}</p>
    <p style="margin:2px 0 0;color:rgba(255,255,255,.8);font-size:13px">spent this week</p>
  </div>
  <div style="padding:20px 24px;font-size:14px">
    <table style="width:100%;border-collapse:collapse">
      <tr><td style="padding:7px 0;border-bottom:1px solid #f0efed">Bills paid</td>
          <td style="padding:7px 0;border-bottom:1px solid #f0efed;text-align:right">${money(bills.paid)}</td></tr>
      <tr><td style="padding:7px 0;border-bottom:1px solid #f0efed">Bills upcoming</td>
          <td style="padding:7px 0;border-bottom:1px solid #f0efed;text-align:right">${money(bills.upcoming)}</td></tr>
      <tr><td style="padding:7px 0">Income</td>
          <td style="padding:7px 0;text-align:right">${money(income)}</td></tr>
    </table>
    <a href="https://budgetfortwo.netlify.app" style="display:block;margin:22px 0 0;background:#1a7a4a;color:#fff;text-decoration:none;text-align:center;padding:13px;border-radius:10px;font-weight:600">Open Budget For Two</a>
  </div>
</div></body></html>`;

    await transport.sendMail({
      from: `"Budget For Two" <${mail.from}>`,
      to: email,
      subject: `Your week: ${money(spending.total)} spent`,
      html,
    });

    return { statusCode: 200, body: JSON.stringify({ ok: true, sentTo: email }) };
  } catch (err) {
    console.error('send-weekly-summary failed:', err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || String(err) }) };
  }
};
