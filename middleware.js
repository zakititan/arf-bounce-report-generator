// Edge Runtime — uses Web Crypto API (available in Vercel Edge)
const COOKIE_NAME = 'auth_session';
const PUBLIC_PATHS = ['/login', '/api/login'];

/**
 * NOTE: This function is intentionally duplicated from api/_utils.js.
 * The two files run in different runtimes:
 *   - middleware.js  → Vercel Edge Runtime (Web Crypto API / crypto.subtle)
 *   - api/_utils.js  → Node.js runtime     (Node 'crypto' module)
 * Do NOT unify them into a shared module — the imports are incompatible across runtimes.
 */
async function verifyToken(token) {
  if (!token || !token.includes('.')) return false;
  const lastDot = token.lastIndexOf('.');
  const payload = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
  try {
    const secret = process.env.AUTH_SECRET;
    if (!secret) return false;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['sign']
    );
    const sigBytes = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
    const expected = Array.from(new Uint8Array(sigBytes)).map(b => b.toString(16).padStart(2, '0')).join('');
    if (expected.length !== sig.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
    return diff === 0;
  } catch {
    return false;
  }
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const { pathname } = url;

  if (
    PUBLIC_PATHS.some(p => pathname.startsWith(p)) ||
    pathname.startsWith('/favicon') ||
    pathname.match(/\.(css|js|png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf)$/)
  ) {
    return;
  }

  const cookie = request.headers.get('cookie') || '';
  const raw = cookie.split(';').map(c => c.trim()).find(c => c.startsWith(COOKIE_NAME + '='));
  const token = raw ? raw.slice(COOKIE_NAME.length + 1) : null;

  if (token && await verifyToken(token)) return;

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('redirect', pathname);
  return Response.redirect(loginUrl, 302);
}

export const config = { matcher: '/(.*)', };
