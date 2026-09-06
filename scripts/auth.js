const INTERNAL_ORIGIN = 'https://internal.invalid';

export function getSafeRedirect(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return null;
  }

  try {
    const url = new URL(value, INTERNAL_ORIGIN);
    if (url.origin !== INTERNAL_ORIGIN) return null;
    return url.pathname + url.search + url.hash;
  } catch {
    return null;
  }
}

export function getLoginRedirect(search) {
  const requested = new URLSearchParams(search || '').get('redirect');
  return getSafeRedirect(requested) || '/';
}

if (typeof window !== 'undefined') {
  window.getSafeRedirect = getSafeRedirect;
  window.getLoginRedirect = getLoginRedirect;
}
