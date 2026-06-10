import { hmacVerify } from './api/_utils.js';

const COOKIE_NAME = 'auth_session';
const PUBLIC_PATHS = ['/login', '/api/login'];

export default async function middleware(request) {
  const url = new URL(request.url);
  const { pathname } = url;

  // Allow public paths and static assets
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

  if (token && await hmacVerify(token)) return;

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('redirect', pathname);
  return Response.redirect(loginUrl, 302);
}

export const config = {
  matcher: '/(.*)',
};
