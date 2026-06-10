import { NextResponse } from 'next/server';

const PUBLIC_PATHS = ['/login', '/api/login'];
const COOKIE_NAME = 'auth_session';
const SESSION_VALUE = 'authenticated';

export function middleware(request) {
  const { pathname } = request.nextUrl;

  // Allow public paths and static assets through
  if (
    PUBLIC_PATHS.some(p => pathname.startsWith(p)) ||
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon')
  ) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get(COOKIE_NAME);
  if (sessionCookie && sessionCookie.value === SESSION_VALUE) {
    return NextResponse.next();
  }

  // Not authenticated — redirect to login
  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('redirect', pathname);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
