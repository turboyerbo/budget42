/**
 * Server-side proxy to the Claude API.
 *
 * The key lives here, in Netlify's environment, and never reaches the browser.
 * Note the variable name has NO `VITE_` prefix — that prefix is precisely what
 * causes Vite to inline a value into the client bundle.
 */
const ALLOWED_MODELS = new Set([
  'claude-sonnet-5',
  'claude-haiku-4-5-20251001',
]);

export default async (req) => {
  // Health check — lets the app show honest UI without exposing anything
  if (req.method === 'GET') {
    return Response.json({ available: !!process.env.ANTHROPIC_API_KEY });
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return Response.json(
      { error: 'no_key',
        message: 'ANTHROPIC_API_KEY is not set in this site\'s environment variables.' },
      { status: 503 }
    );
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'bad_request' }, { status: 400 });
  }

  // Only let the browser reach the models this app actually uses, and cap the
  // response size. Without this, an exposed endpoint is an open bill.
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
      { status: 502 }
    );
  }
};

export const config = { path: '/api/claude' };
