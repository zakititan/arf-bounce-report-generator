// Edge Runtime — uses Web Crypto API (available in Vercel Edge)
const COOKIE_NAME = '__Host-auth_session';
const PUBLIC_PATHS = ['/login', '/api/login'];

let _cachedKey = null;
let _cachedSecret = null;

async function getHmacKey() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) return null;
  if (_cachedKey && _cachedSecret === secret) return _cachedKey;
  const enc = new TextEncoder();
  _cachedKey = await crypto.subtle.importKey(
    'raw', enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign']
  );
  _cachedSecret = secret;
  return _cachedKey;
}

async function verifyToken(token) {
  if (!token || !token.includes('.')) return false;
  const lastDot = token.lastIndexOf('.');
  const payload = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);
  try {
    const key = await getHmacKey();
    if (!key) return false;
    const enc = new TextEncoder();
    const sigBytes = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
    const expected = Array.from(new Uint8Array(sigBytes)).map(b => b.toString(16).padStart(2, '0')).join('');
    if (expected.length !== sig.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
    if (diff !== 0) return false;

    let parsed;
    try { parsed = JSON.parse(payload); } catch { return false; }
    if (!parsed || parsed.sub !== 'authenticated' || typeof parsed.iat !== 'number') return false;
    const age = Date.now() - parsed.iat;
    const MAX_AGE_MS = 8 * 60 * 60 * 1000;
    if (age > MAX_AGE_MS || age < 0) return false;

    return true;
  } catch {
    return false;
  }
}

export default async function middleware(request) {
  const url = new URL(request.url);
  const { pathname } = url;

  if (
    PUBLIC_PATHS.some(p => pathname === p || pathname.startsWith(p + '/')) ||
    pathname.startsWith('/favicon') ||
    pathname.match(/\.(css|js|map|png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf)$/)
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
