// ── Content script: Report Generator web app ─────────────────────────
// Listens for report data from the page and stores directly in chrome.storage.local.

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (!event.data || event.data.type !== 'REPORT_GENERATOR_JIRA') return;

  const { text, html, panel, account, timestamp } = event.data;
  if (!text && !html) return;

  const reportData = { text, html, panel, account, timestamp: timestamp || Date.now() };

  chrome.storage.local.set({ reportData }, () => {
    if (chrome.runtime.lastError) {
      console.warn('[Report→JIRA] Storage write failed:', chrome.runtime.lastError.message);
    } else {
      console.log('[Report→JIRA] Report stored successfully');
    }
  });
});
