/**
 * Single entry point for every Claude call.
 *
 * Requests go to our own serverless function, which holds the API key. The
 * browser never sees it, so the key cannot be lifted out of the bundle and
 * Netlify's secret scanner has nothing to complain about.
 */
const ENDPOINT = '/api/claude';

let cachedAvailability = null;
let lastDiagnostics    = null;

/**
 * Is the key configured AND accepted by Anthropic?
 *
 * Checking only that the variable exists is misleading: a truncated or revoked
 * key looks configured and then fails on first use. This makes a one-token call
 * to prove it actually works, and caches the verdict.
 */
export async function checkAI() {
  if (cachedAvailability !== null) return cachedAvailability;
  try {
    const res = await fetch(ENDPOINT + '?verify=1', { method: 'GET' });
    const out = await res.json();
    lastDiagnostics    = out;
    cachedAvailability = !!out.available;
  } catch {
    cachedAvailability = false;
  }
  return cachedAvailability;
}

/** Details of the last health check — used to explain failures precisely. */
export function aiDiagnostics() { return lastDiagnostics; }

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
  if (res.status === 401) {
    cachedAvailability = false;
    throw new Error(
      'Anthropic rejected the API key. The variable is set, but the value is wrong. ' +
      'Usually this means the key was truncated when pasted, has been revoked, or ' +
      'belongs to a different account. Create a fresh key and paste the whole thing.'
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
