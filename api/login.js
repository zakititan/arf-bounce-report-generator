const PASSWORD = process.env.SITE_PASSWORD || 'changeme';
const COOKIE_NAME = 'auth_session';
const MAX_AGE = 60 * 60 * 8; // 8 hours

export default function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { password } = req.body || {};

  if (!password || password !== PASSWORD) {
    res.status(401).json({ error: 'Incorrect password' });
    return;
  }

  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=authenticated; HttpOnly; Secure; SameSite=Strict; Max-Age=${MAX_AGE}; Path=/`
  );
  res.status(200).json({ ok: true });
}
