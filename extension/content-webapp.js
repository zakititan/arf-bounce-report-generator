// ── Content script: Report Generator web app ─────────────────────────
// Listens for report data from the page and forwards to background.

window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (!event.data || event.data.type !== 'REPORT_GENERATOR_JIRA') return;

  const { text, html, panel, account, timestamp } = event.data;
  if (!text && !html) return;

  chrome.runtime.sendMessage(
    {
      action: 'store-report',
      data: { text, html, panel, account, timestamp },
    },
    (response) => {
      if (chrome.runtime.lastError) {
        console.warn('[Report→JIRA] Failed to store report:', chrome.runtime.lastError.message);
      }
    }
  );
});
