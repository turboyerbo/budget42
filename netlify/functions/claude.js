/**
 * Server-side proxy to the Claude API.
 *
 * The key lives here, in Netlify's environment, and never reaches the browser.
 * The variable name deliberately has no `VITE_` prefix: that prefix is what
 * makes Vite inline a value into the client bundle.
 */
const ALLOWED_MODELS = new Set([
  'claude-sonnet-5',
  'claude-haiku-4-5-20251001',
]);

/**
 * Copy-pasting a key out of a browser dialog and into a Netlify form very often
 * drags along a trailing newline, a stray space, or a pair of quotes. Any of
 * those produce a 401 that looks exactly like a wrong key, so clean it up.
 */
function readKey() {
  let k = process.env.ANTHROPIC_API_KEY || '';
  k = k.trim().replace(/^["']|["']$/g, '').trim();
  return k;
}

/** Diagnostics that help without revealing the secret. */
function describeKey(k) {
  if (!k) return { present: false };
  return {
    present:      true,
    looksValid:   k.startsWith('sk-ant-'),
    length:       k.length,
    startsWith:   k.slice(0, 11) + '…',
    endsWith:     '…' + k.slice(-4),
    hadWhitespace: k !== (process.env.ANTHROPIC_API_KEY || ''),
  };
}

export default async (req) => {
  const key = readKey();

  // ── Health / diagnostics ──────────────────────────────────────────────────
  if (req.method === 'GET') {
    const url    = new URL(req.url);
    const verify = url.searchParams.get('verify') === '1';
    const info   = describeKey(key);

    if (!key)   return Response.json({ available: false, reason: 'missing', ...info });
    if (!verify) return Response.json({ available: true, ...info });

    // Actually spend a token proving the key works, rather than assuming
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type':      'application/json',
          'x-api-key':         key,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model:      'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages:   [{ role: 'user', content: 'hi' }],
        }),
      });

      if (res.ok) return Response.json({ available: true, verified: true, ...info });

      const body = await res.json().catch(() => ({}));
      return Response.json({
        available: false,
        verified:  false,
        reason:    res.status === 401 ? 'rejected'
                 : res.status === 400 ? 'bad_request'
                 : 'error',
        status:    res.status,
        message:   body?.error?.message || 'Anthropic rejected the key.',
        ...info,
      });
    } catch (err) {
      return Response.json({ available: false, reason: 'unreachable',
                             message: String(err.message || err), ...info });
    }
  }

  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  if (!key) {
    return Response.json(
      { error: 'no_key',
        message: 'ANTHROPIC_API_KEY is not set in this site\'s environment variables.' },
      { status: 503 });
  }

  let body;
  try { body = await req.json(); }
  catch { return Response.json({ error: 'bad_request' }, { status: 400 }); }

  // Keep the endpoint from being usable as a free general-purpose API
  if (!ALLOWED_MODELS.has(body?.model)) {
    return Response.json({ error: 'model_not_allowed' }, { status: 400 });
  }
  body.max_tokens = Math.min(body.max_tokens || 1024, 8192);

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    return new Response(text, {
      status:  res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return Response.json(
      { error: 'upstream_failed', message: String(err.message || err) },
      { status: 502 });
  }
};

export const config = { path: '/api/claude' };
