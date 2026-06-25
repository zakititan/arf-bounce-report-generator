import { withMiddleware } from './_utils.js';

export default withMiddleware(async function handler(req, res) {
  const sheetId = process.env.GOOGLE_SHEET_ID || '';
  const appsScriptUrl = process.env.APPS_SCRIPT_URL || '';
  return res.status(200).json({ sheetId, appsScriptUrl });
});
