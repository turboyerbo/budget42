/**
 * Single entry point for every Claude call.
 *
 * Requests go to our own serverless function, which holds the API key. The
 * browser never sees it, so the key cannot be lifted out of the bundle and
 * Netlify's secret scanner has nothing to complain about.
 */
const ENDPOINT = '/api/claude';

let cachedAvailability = null;

/** Is the key configured on the server? Cached after the first check. */
export async function checkAI() {
  if (cachedAvailability !== null) return cachedAvailability;
  try {
    const res = await fetch(ENDPOINT, { method: 'GET' });
    const out = await res.json();
    cachedAvailability = !!out.available;
  } catch {
    cachedAvailability = false;
  }
  return cachedAvailability;
}

/** POST a Messages API payload. Throws with a readable message on failure. */
export async function callClaude(payload) {
  const res = await fetch(ENDPOINT, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });

  if (res.status === 503) {
    cachedAvailability = false;
    throw new Error(
      'The Claude API key is not configured on the server. Add ANTHROPIC_API_KEY ' +
      'to your Netlify environment variables and redeploy.'
    );
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch {}
    throw new Error(`Claude API error ${res.status}${detail ? ': ' + detail : ''}`);
  }
  return res.json();
}

/** Pull the text out of a Messages response and strip any markdown fencing. */
export function textOf(data) {
  return (data.content?.[0]?.text || '').replace(/```json?|```/g, '').trim();
}
