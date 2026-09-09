/**
 * Open this in a browser to see exactly what's configured and what isn't:
 *   https://budgetfortwo.netlify.app/.netlify/functions/email-check
 *
 * It reports nothing secret — only whether each value is present, plus a
 * masked hint so you can tell you pasted the right one. Setting this up
 * involved too much guessing; this makes the state visible.
 */
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';
import { resolveMailConfig } from './weekly-summary.js';

const mask = v => !v ? null
  : v.length <= 6 ? '••••' : v.slice(0, 3) + '••••' + v.slice(-3);

export default async function handler() {
  const env = process.env;
  const mail = resolveMailConfig(env);
  const out = {
    email: {
      configured: !!mail,
      sendsFrom: mail?.from || null,
      GMAIL_USER: mask(env.GMAIL_USER) || 'NOT SET',
      GMAIL_APP_PASSWORD: env.GMAIL_APP_PASSWORD ? 'set' : 'NOT SET',
    },
    supabase: {
      SUPABASE_URL: env.SUPABASE_URL ? 'set' : null,
      SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY ? 'set' : null,
    },
    checks: {},
    nextStep: null,
  };

  // Does the mail server actually accept these credentials?
  if (mail) {
    try {
      await nodemailer.createTransport(mail.transport).verify();
      out.checks.smtpLogin = 'OK — the mail server accepted these credentials';
    } catch (e) {
      out.checks.smtpLogin = 'FAILED — ' + (e.message || String(e));
    }
  } else {
    out.checks.smtpLogin = 'skipped — no email credentials set';
  }

  // Can we reach Supabase and see any users to email?
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
      const { data, error } = await db.auth.admin.listUsers({ perPage: 1000 });
      if (error) throw error;
      const withEmail = (data?.users || []).filter(u => u.email);
      out.checks.supabase = `OK — ${withEmail.length} user(s) would receive the weekly email`;
      out.checks.recipients = withEmail.map(u => mask(u.email));
    } catch (e) {
      out.checks.supabase = 'FAILED — ' + (e.message || String(e));
    }
  } else {
    out.checks.supabase = 'skipped — Supabase variables not set';
  }

  out.nextStep =
    !mail ? 'Set GMAIL_USER and GMAIL_APP_PASSWORD in Netlify, then redeploy.'
    : String(out.checks.smtpLogin).startsWith('FAILED') ? 'Gmail rejected the login. Check GMAIL_APP_PASSWORD is a 16-character App Password (not your Google password) and that 2-Step Verification is on.'
    : !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY ? 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in Netlify, then redeploy.'
    : String(out.checks.supabase).startsWith('FAILED') ? 'Supabase rejected the service-role key — re-copy it from Project Settings → API.'
    : 'Everything is configured. Run the weekly-summary function to send now, or wait for Friday.';

  return new Response(JSON.stringify(out, null, 2), {
    status: 200, headers: { 'Content-Type': 'application/json' },
  });
}

export const config = { path: '/.netlify/functions/email-check' };
