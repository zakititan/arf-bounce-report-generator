/**
 * config.js — Single source of truth for all API constants.
 * Import from here; never hardcode these values in individual handlers.
 */

// ── Rate limiting ────────────────────────────────────────────────────────────
export const RATE_LIMIT_MAX      = 20;      // requests per window per IP
export const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute

export const SESSION_MAX_AGE_MS = 8 * 60 * 60 * 1000; // 8 hours (matches cookie Max-Age)
export const SESSION_MAX_AGE_S  = SESSION_MAX_AGE_MS / 1000;

// ── Timeouts (ms) ────────────────────────────────────────────────────────────
export const TIMEOUT_WHOIS_MS   = 10_000; // WhoisJSON is occasionally slow
export const TIMEOUT_WEBSITE_MS =  8_000; // website-check (two-URL fallback)
export const TIMEOUT_DKIM_MS    =  5_000; // parallel DNS queries
export const TIMEOUT_HEALTH_MS  =  5_000; // health-check probes

// ── DKIM ─────────────────────────────────────────────────────────────────────
export const DKIM_FAMILIES      = ['titan', 'neo'];
// Use Array.from so the range is easy to extend without missing a number
export const DKIM_INDEXED_RANGE = Array.from({ length: 9 }, (_, i) => i + 1);

// All selectors: titan, titan1…titan9, neo, neo1…neo9
export const DKIM_SELECTORS = DKIM_FAMILIES.flatMap(family => [
  family,
  ...DKIM_INDEXED_RANGE.map(n => `${family}${n}`),
]);

// ── Website check ─────────────────────────────────────────────────────────────
export const WEBSITE_MAX_BODY_BYTES   = 80_000;
export const WEBSITE_MIN_CONTENT_LEN  = 300;

// Phrases that, when found in the page title, indicate a parked or placeholder site
// NOTE: avoid overly generic phrases like 'welcome to', 'it works', 'index of'
// which commonly appear on legitimate sites.
export const PARKED_TITLE_KEYWORDS = [
  'parked', 'for sale', 'buy this domain', 'domain is parked',
  'domain name is for sale', 'coming soon', 'under construction',
  'this domain', 'default page', 'placeholder', 'sitio en construcción',
  'site en construction', 'page d\'accueil',
  'default web page',
];

// Phrases anywhere in the body that strongly indicate parked/placeholder pages.
// NOTE: avoid overly generic phrases like 'powered by', 'built with', 'buy now',
// 'register domain', 'web hosting' that commonly appear on legitimate sites.
export const PARKED_KEYWORDS = [
  'parked', 'for sale', 'buy this domain', 'domain for sale', 'domain is parked',
  'under construction', 'coming soon', 'this domain', 'sedoparking',
  'hugedomains', 'dan.com', 'godaddy parking', 'godaddy default page', 'namecheap parking', 'afternic',
  'brandbucket', 'this page is intentionally left blank', 'default web page',
  'placeholder page', 'welcome to nginx', 'welcome to apache',
  'it works!', 'test page for', 'apache2 ubuntu default',
  'this domain is parked', 'domain name is for sale',
  'buy this domain name', 'sedo parking', 'domain parking',
  'this webpage is parked', 'is parked free', 'parking page',
  'this domain may be for sale', 'domain registration',
  'your domain is expired', 'renew your domain',
  'is for sale on afternic', 'is for sale at afternic',
  'purchase this domain', 'own this domain',
  'get this domain', 'claim this domain',
  // Builder / CMS default pages
  'welcome to your site', 'edit your site',
  'your website is coming soon', 'this site was built with',
  'create your website',
  'welcome to wordpress', 'welcome to joomla',
  'default page - cpanel', 'cpanel default page',
  'plesk default page', 'iis windows server',
  'apache is functioning normally', 'nginx is functioning normally',
  'this is the default index page', 'no site configured',
  'website is not configured', 'default website',
];

// Known domain-parking / placeholder services (checked via redirect target)
export const PARKED_DOMAIN_PATTERNS = [
  'sedo.com', 'afternic.com', 'dan.com', 'hugedomains.com',
  'godaddy.com', 'namecheap.com', 'brandbucket.com',
  'bodis.com', 'parkingcrew.net', 'voodoo.com',
  'cashparking.com', 'domainmarket.com', 'buydomains.com',
  'undeveloped.com', 'afternic', 'sedoparking',
];

// Minimum ratio of visible text to total bytes (filters out image-only / thin-content pages)
export const WEBSITE_MIN_TEXT_RATIO = 0.01;

// SPA root mount element selectors — pages with these + JS bundles are likely legit SPAs
export const SPA_ROOT_PATTERNS = [
  'id="root"', "id='root'", 'id="app"', "id='app'",
  'id="__nuxt"', 'id="__next"', 'id="gatsby-focus-wrapper"',
  '<app-root>', '<app-component>',
];

// ── Security: domain sanitisation ────────────────────────────────────────────
// Matches bare IPv4 addresses (e.g. 192.168.1.1) — already rejected in sanitiseDomain
export const IPV4_PATTERN = /^(\d{1,3}\.){3}\d{1,3}$/;

// Matches IPv6 addresses in bare or bracket form (e.g. ::1, [::1], 2001:db8::1)
export const IPV6_PATTERN = /^\[?[0-9a-f:]+\]?$/i;

// Hostnames that must never be fetched to prevent SSRF
export const LOCALHOST_NAMES = ['localhost', '0.0.0.0', 'ip6-localhost', 'ip6-loopback'];

// ── RDAP (Registration Data Access Protocol) ─────────────────────────────────
// RDAP is the ICANN-mandated WHOIS successor. Returns structured JSON.
// We use a hardcoded map for common TLDs and fetch the IANA bootstrap for others.
export const RDAP_BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json';
export const TIMEOUT_RDAP_MS = 8_000;

// Hardcoded TLD → RDAP server URL mapping.
// Source: IANA RDAP bootstrap file (published 2026-06-09).
// Covers ~99% of real-world domain lookups.
export const RDAP_TLD_MAP = {
  // ── Verisign ──
  com: 'https://rdap.verisign.com/com/v1/',
  net: 'https://rdap.verisign.com/net/v1/',
  cc: 'https://tld-rdap.verisign.com/cc/v1/',
  name: 'https://tld-rdap.verisign.com/name/v1/',

  // ── Public Interest Registry ──
  org: 'https://rdap.publicinterestregistry.org/rdap/',
  charity: 'https://rdap.publicinterestregistry.org/rdap/',
  foundation: 'https://rdap.publicinterestregistry.org/rdap/',
  ngo: 'https://rdap.publicinterestregistry.org/rdap/',
  ong: 'https://rdap.publicinterestregistry.org/rdap/',

  // ── Identity Digital (450+ TLDs) ──
  info: 'https://rdap.identitydigital.services/rdap/',
  ai: 'https://rdap.identitydigital.services/rdap/',
  io: 'https://rdap.identitydigital.services/rdap/',
  pro: 'https://rdap.identitydigital.services/rdap/',
  mobi: 'https://rdap.identitydigital.services/rdap/',
  travel: 'https://rdap.identitydigital.services/rdap/',
  asia: 'https://rdap.identitydigital.services/rdap/',
  post: 'https://rdap.identitydigital.services/rdap/',
  life: 'https://rdap.identitydigital.services/rdap/',
  live: 'https://rdap.identitydigital.services/rdap/',
  social: 'https://rdap.identitydigital.services/rdap/',
  news: 'https://rdap.identitydigital.services/rdap/',
  blog: 'https://rdap.identitydigital.services/rdap/',
  global: 'https://rdap.identitydigital.services/rdap/',
  digital: 'https://rdap.identitydigital.services/rdap/',
  school: 'https://rdap.identitydigital.services/rdap/',
  group: 'https://rdap.identitydigital.services/rdap/',
  email: 'https://rdap.identitydigital.services/rdap/',
  solar: 'https://rdap.identitydigital.services/rdap/',
  energy: 'https://rdap.identitydigital.services/rdap/',
  fund: 'https://rdap.identitydigital.services/rdap/',
  capital: 'https://rdap.identitydigital.services/rdap/',
  finance: 'https://rdap.identitydigital.services/rdap/',
  lawyer: 'https://rdap.identitydigital.services/rdap/',
  ventures: 'https://rdap.identitydigital.services/rdap/',
  enterprises: 'https://rdap.identitydigital.services/rdap/',
  solutions: 'https://rdap.identitydigital.services/rdap/',
  network: 'https://rdap.identitydigital.services/rdap/',
  technology: 'https://rdap.identitydigital.services/rdap/',
  today: 'https://rdap.identitydigital.services/rdap/',
  rocks: 'https://rdap.identitydigital.services/rdap/',
  guru: 'https://rdap.identitydigital.services/rdap/',
  codes: 'https://rdap.identitydigital.services/rdap/',
  kitchen: 'https://rdap.identitydigital.services/rdap/',
  photography: 'https://rdap.identitydigital.services/rdap/',
  photos: 'https://rdap.identitydigital.services/rdap/',
  graphics: 'https://rdap.identitydigital.services/rdap/',
  golf: 'https://rdap.identitydigital.services/rdap/',
  tennis: 'https://rdap.identitydigital.services/rdap/',
  racing: 'https://rdap.identitydigital.services/rdap/',
  football: 'https://rdap.identitydigital.services/rdap/',
  soccer: 'https://rdap.identitydigital.services/rdap/',
  hockey: 'https://rdap.identitydigital.services/rdap/',
  fitness: 'https://rdap.identitydigital.services/rdap/',
  vegas: 'https://rdap.identitydigital.services/rdap/',
  holiday: 'https://rdap.identitydigital.services/rdap/',
  vacations: 'https://rdap.identitydigital.services/rdap/',
  flights: 'https://rdap.identitydigital.services/rdap/',
  cruises: 'https://rdap.identitydigital.services/rdap/',
  restaurant: 'https://rdap.identitydigital.services/rdap/',
  pizza: 'https://rdap.identitydigital.services/rdap/',
  coffee: 'https://rdap.identitydigital.services/rdap/',
  wine: 'https://rdap.identitydigital.services/rdap/',
  beer: 'https://rdap.identitydigital.services/rdap/',
  pub: 'https://rdap.identitydigital.services/rdap/',
  recipes: 'https://rdap.identitydigital.services/rdap/',
  camp: 'https://rdap.identitydigital.services/rdap/',
  surf: 'https://rdap.identitydigital.services/rdap/',
  ski: 'https://rdap.identitydigital.services/rdap/',
  fishing: 'https://rdap.identitydigital.services/rdap/',
  ninja: 'https://rdap.identitydigital.services/rdap/',
  yoga: 'https://rdap.identitydigital.services/rdap/',
  world: 'https://rdap.identitydigital.services/rdap/',
  zone: 'https://rdap.identitydigital.services/rdap/',
  earth: 'https://rdap.identitydigital.services/rdap/',
  space: 'https://rdap.identitydigital.services/rdap/',
  wiki: 'https://rdap.identitydigital.services/rdap/',
  studio: 'https://rdap.identitydigital.services/rdap/',
  one: 'https://rdap.identitydigital.services/rdap/',
  business: 'https://rdap.identitydigital.services/rdap/',
  company: 'https://rdap.identitydigital.services/rdap/',
  holdings: 'https://rdap.identitydigital.services/rdap/',
  management: 'https://rdap.identitydigital.services/rdap/',
  consulting: 'https://rdap.identitydigital.services/rdap/',
  services: 'https://rdap.identitydigital.services/rdap/',
  partners: 'https://rdap.identitydigital.services/rdap/',
  marketing: 'https://rdap.identitydigital.services/rdap/',
  market: 'https://rdap.identitydigital.services/rdap/',
  markets: 'https://rdap.identitydigital.services/rdap/',
  trading: 'https://rdap.identitydigital.services/rdap/',
  money: 'https://rdap.identitydigital.services/rdap/',
  bank: 'https://rdap.identitydigital.services/rdap/',
  cloud: 'https://rdap.identitydigital.services/rdap/',
  data: 'https://rdap.identitydigital.services/rdap/',
  security: 'https://rdap.identitydigital.services/rdap/',
  storage: 'https://rdap.identitydigital.services/rdap/',
  hosting: 'https://rdap.identitydigital.services/rdap/',
  domains: 'https://rdap.identitydigital.services/rdap/',
  fashion: 'https://rdap.identitydigital.services/rdap/',
  luxury: 'https://rdap.identitydigital.services/rdap/',
  beauty: 'https://rdap.identitydigital.services/rdap/',
  garden: 'https://rdap.identitydigital.services/rdap/',
  horse: 'https://rdap.identitydigital.services/rdap/',
  pet: 'https://rdap.identitydigital.services/rdap/',
  baby: 'https://rdap.identitydigital.services/rdap/',
  kids: 'https://rdap.identitydigital.services/rdap/',
  family: 'https://rdap.identitydigital.services/rdap/',
  singles: 'https://rdap.identitydigital.services/rdap/',
  dating: 'https://rdap.identitydigital.services/rdap/',
  love: 'https://rdap.identitydigital.services/rdap/',
  wedding: 'https://rdap.identitydigital.services/rdap/',
  university: 'https://rdap.identitydigital.services/rdap/',
  education: 'https://rdap.identitydigital.services/rdap/',
  academy: 'https://rdap.identitydigital.services/rdap/',
  courses: 'https://rdap.identitydigital.services/rdap/',
  property: 'https://rdap.identitydigital.services/rdap/',
  casino: 'https://rdap.identitydigital.services/rdap/',
  poker: 'https://rdap.identitydigital.services/rdap/',
  bingo: 'https://rdap.identitydigital.services/rdap/',
  lottery: 'https://rdap.identitydigital.services/rdap/',
  bet: 'https://rdap.identitydigital.services/rdap/',
  games: 'https://rdap.identitydigital.services/rdap/',
  hockey: 'https://rdap.identitydigital.services/rdap/',
  rugby: 'https://rdap.identitydigital.services/rdap/',
  cricket: 'https://rdap.identitydigital.services/rdap/',
  football: 'https://rdap.identitydigital.services/rdap/',
  baseball: 'https://rdap.identitydigital.services/rdap/',
  basketball: 'https://rdap.identitydigital.services/rdap/',
  volleyball: 'https://rdap.identitydigital.services/rdap/',
  // ── Google Registry ──
  app: 'https://pubapi.registry.google/rdap/',
  dev: 'https://pubapi.registry.google/rdap/',
  page: 'https://pubapi.registry.google/rdap/',
  new: 'https://pubapi.registry.google/rdap/',
  // ── Nominet UK ──
  uk: 'https://rdap.nominet.uk/uk/',
  jobs: 'https://rdap.nominet.uk/jobs/',
  // ── CentralNic ──
  xyz: 'https://rdap.centralnic.com/xyz/',
  london: 'https://rdap.centralnic.com/london/',
  paris: 'https://rdap.centralnic.com/paris/',
  berlin: 'https://rdap.centralnic.com/berlin/',
  hamburg: 'https://rdap.centralnic.com/hamburg/',
  amsterdam: 'https://rdap.centralnic.com/amsterdam/',
  miami: 'https://rdap.centralnic.com/miami/',
  nyc: 'https://rdap.centralnic.com/nyc/',
  tokyo: 'https://rdap.centralnic.com/tokyo/',
  fm: 'https://rdap.centralnic.com/fm/',
  inc: 'https://rdap.centralnic.com/inc/',
  // ── Radix ──
  site: 'https://rdap.radix.host/rdap/',
  online: 'https://rdap.radix.host/rdap/',
  tech: 'https://rdap.radix.host/rdap/',
  store: 'https://rdap.radix.host/rdap/',
  fun: 'https://rdap.radix.host/rdap/',
  press: 'https://rdap.radix.host/rdap/',
  host: 'https://rdap.radix.host/rdap/',
  website: 'https://rdap.radix.host/rdap/',
  uno: 'https://rdap.radix.host/rdap/',
  pw: 'https://rdap.radix.host/rdap/',
  // ── Tucows ──
  click: 'https://rdap.tucowsregistry.net/rdap/',
  link: 'https://rdap.tucowsregistry.net/rdap/',
  // ── ccTLDs ──
  ca: 'https://rdap.ca.fury.ca/rdap/',
  au: 'https://rdap.cctld.au/rdap/',
  fr: 'https://rdap.nic.fr/',
  nl: 'https://rdap.sidn.nl/',
  br: 'https://rdap.registro.br/',
  in: 'https://rdap.nixiregistry.in/rdap/',
  pl: 'https://rdap.dns.pl/',
  no: 'https://rdap.norid.no/',
  fi: 'https://rdap.fi/rdap/rdap/',
  cz: 'https://rdap.nic.cz/',
  ar: 'https://rdap.nic.ar/',
  sg: 'https://rdap.sgnic.sg/rdap/',
  nz: 'https://rs.nic.nz/rdap/',
  ie: 'https://rdap.weare.ie/',
  de: 'https://rdap.denic.de/',
  eu: 'https://rdap.eu/',
  ch: 'https://rdap.nic.ch/',
  at: 'https://rdap.nic.at/',
  es: 'https://rdap.nic.es/',
  it: 'https://rdap.nic.it/',
  pt: 'https://rdap.dns.pt/',
  se: 'https://rdap.iis.se/',
  dk: 'https://rdap.dk-hostmaster.dk/',
  be: 'https://rdap.dns.be/',
  jp: 'https://rdap.jprs.jp/',
  cn: 'https://rdap.cnnic.cn/rdap/',
  kr: 'https://rdap.kr/rdap/',
  ru: 'https://rdap.tcinet.ru/',
  ua: 'https://rdap.hostmaster.ua/',
  us: 'https://rdap.nic.us/',
  me: 'https://rdap.nic.me/',
  co: 'https://rdap.nic.co/',
  tv: 'https://rdap.nic.tv/',
  ly: 'https://rdap.nic.ly/',
  to: 'https://rdap.nic.to/',
  am: 'https://rdap.nic.am/',
  im: 'https://rdap.nic.im/',
  gs: 'https://rdap.nic.gs/',
  // ── GMO Registry ──
  shop: 'https://rdap.gmoregistry.net/rdap/',
  // ── ZDNS (China) ──
  top: 'https://rdap.zdnsgtld.com/top/',
  wang: 'https://rdap.zdnsgtld.com/wang/',
  // ── Registry.coop ──
  coop: 'https://rdap.registry.coop/rdap/',
  // ── Registry.bar ──
  bar: 'https://rdap.registry.bar/',
  rest: 'https://rdap.registry.bar/',
  // ── HTTP-only (less reliable) ──
  kg: 'http://rdap.cctld.kg/',
  mg: 'http://rdap.nic.mg/',
};
