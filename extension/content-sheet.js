// extension/content-sheet.js
// Runs on docs.google.com/spreadsheets/* - listens for append-sheet-row messages
// and writes data to the sheet using keyboard navigation + execCommand

(function () {
  const CELL_DELAY_MS = 300;

  function log(msg) { console.log('[Report->Sheet] ' + msg); }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action !== 'append-sheet-row') return;
    console.log('[Report->Sheet] Received message with data:', message.data);
    appendRow(message.data).then(function(ok) {
      console.log('[Report->Sheet] appendRow result:', ok);
      sendResponse({ success: ok });
    }).catch(function(err) {
      console.log('[Report->Sheet] appendRow error:', err);
      sendResponse({ success: false, error: err.message });
    });
    return true;
  });

  async function getNextEmptyRow() {
    log('getNextEmptyRow called');
    log('Finding next empty row...');
    try {
      var nameBox = document.querySelector('#t-name-box-input, #t-name-box, .docs-name-box-input, [aria-label="Name Box"]');
      if (!nameBox) {
        log('Name Box not found - trying alternate selectors');
        var inputs = document.querySelectorAll('input');
        for (var i = 0; i < inputs.length; i++) {
          if (inputs[i].id && inputs[i].id.indexOf('name') !== -1) {
            nameBox = inputs[i];
            break;
          }
        }
        if (!nameBox) return { nextRow: 2, nextIndex: 1 };
      }

      // Navigate to A1
      nameBox.focus();
      nameBox.select();
      document.execCommand('insertText', false, 'A1');
      nameBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      await sleep(500);

      // Press Ctrl+ArrowDown to jump to last filled cell in column A
      var activeEl = document.activeElement || document.body;
      activeEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40, ctrlKey: true, bubbles: true }));
      await sleep(500);

      // Read Name Box value
      var cellRef = nameBox.value;
      log('Name Box after Ctrl+Down: "' + cellRef + '"');
      var match = cellRef && cellRef.match(/(\d+)$/);
      if (match) {
        var lastRow = parseInt(match[1], 10);
        return { nextRow: lastRow + 1, nextIndex: lastRow };
      }
    } catch (e) {
      log('Row detection error: ' + e.message);
    }
    return { nextRow: 2, nextIndex: 1 };
  }

  async function appendRow(data) {
    try {
      var { nextRow, nextIndex } = await getNextEmptyRow();
      log('Target row: ' + nextRow + ' (index: ' + nextIndex + ')');

      var nameBox = document.querySelector('#t-name-box-input, #t-name-box, .docs-name-box-input, [aria-label="Name Box"]');
      if (!nameBox) { log('Name Box not found - aborting'); return false; }

      var values = [
        String(nextIndex),
        data.date || '',
        data.zdLink || '',
        data.jiraLink || '',
        data.domainEmail || '',
        data.type || '',
        data.reason || ''
      ];

      for (var i = 0; i < values.length; i++) {
        var col = String.fromCharCode(65 + i); // A, B, C, D, E, F, G
        var cellRef = col + nextRow;

        // Navigate to cell
        nameBox.focus();
        nameBox.select();
        document.execCommand('insertText', false, cellRef);
        nameBox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        await sleep(400);

        // Enter edit mode with F2
        if (document.activeElement) {
          document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'F2', code: 'F2', keyCode: 113, which: 113, bubbles: true }));
        }
        await sleep(200);

        // Type value
        if (values[i]) {
          document.execCommand('insertText', false, values[i]);
          await sleep(200);
        }

        // Tab to next (or Enter after last)
        if (i < values.length - 1) {
          if (document.activeElement) {
            document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', keyCode: 9, which: 9, bubbles: true }));
          }
        } else {
          if (document.activeElement) {
            document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
          }
        }
        await sleep(200);
      }

      log('Row written successfully at row ' + nextRow);
      return true;
    } catch (e) {
      log('appendRow error: ' + e.message);
      return false;
    }
  }

  function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
})();
