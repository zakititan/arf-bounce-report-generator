// extension/content-sheet.js
// Runs on docs.google.com/spreadsheets/* - listens for append-sheet-row messages
// and writes data to the sheet using keyboard navigation + execCommand

(function () {
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
    log('getNextEmptyRow: starting from B3 (rows 1-2 are frozen)');
    try {
      var nameBox = document.querySelector(
        '#t-name-box-input, #t-name-box, .docs-name-box-input, [aria-label="Name Box"]'
      );
      if (!nameBox) {
        log('Name Box not found - defaulting to row 3');
        return 3;
      }

      // Navigate to B3 — first data cell (rows 1+2 are frozen header rows)
      nameBox.focus();
      nameBox.select();
      document.execCommand('insertText', false, 'B3');
      nameBox.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
      }));
      await sleep(500);

      // Read Name Box to confirm we landed on B3
      var confirmedRef = nameBox.value;
      log('Confirmed cell after navigating to B3: "' + confirmedRef + '"');

      // Press Ctrl+ArrowDown to jump to last filled cell in column B
      var activeEl = document.activeElement || document.body;
      activeEl.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40,
        ctrlKey: true, bubbles: true
      }));
      await sleep(500);

      var cellRef = nameBox.value;
      log('Name Box after Ctrl+ArrowDown: "' + cellRef + '"');

      var match = cellRef && cellRef.match(/(\d+)$/);
      if (match) {
        var lastFilledRow = parseInt(match[1], 10);

        // Edge case: if Ctrl+ArrowDown landed on B3 itself,
        // the sheet is empty — B3 is the first available row
        if (lastFilledRow === 3) {
          // Check if B3 is actually empty by reading cell reference
          // If we started at B3 and didn't move, it means B3 is empty = first available
          if (confirmedRef === cellRef) {
            log('B3 is empty — first data row is 3');
            return 3;
          }
        }

        // Normal case: Ctrl+ArrowDown moved us to the last filled row
        // Next empty row is one below
        var nextRow = lastFilledRow + 1;
        log('Last filled row: ' + lastFilledRow + ', next empty row: ' + nextRow);
        return nextRow;
      }
    } catch (e) {
      log('getNextEmptyRow error: ' + e.message);
    }

    // Safe fallback: row 3 (never overwrite frozen rows 1 and 2)
    log('Falling back to row 3');
    return 3;
  }

  async function appendRow(data) {
    try {
      var nextRow = await getNextEmptyRow();
      log('Target row: ' + nextRow);

      var nameBox = document.querySelector(
        '#t-name-box-input, #t-name-box, .docs-name-box-input, [aria-label="Name Box"]'
      );
      if (!nameBox) { log('Name Box not found - aborting'); return false; }

      var values = [
        data.date        || '',
        data.zdLink      || '',
        data.jiraLink    || '',
        data.domainEmail || '',
        data.type        || '',
        data.reason      || ''
      ];

      for (var i = 0; i < values.length; i++) {
        var col = String.fromCharCode(65 + i); // A, B, C, D, E, F
        var cellRef = col + nextRow;

        // Navigate to cell
        nameBox.focus();
        nameBox.select();
        document.execCommand('insertText', false, cellRef);
        nameBox.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
        }));
        await sleep(400);

        // Enter edit mode with F2
        if (document.activeElement) {
          document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'F2', code: 'F2', keyCode: 113, which: 113, bubbles: true
          }));
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
            document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'Tab', code: 'Tab', keyCode: 9, which: 9, bubbles: true
            }));
          }
        } else {
          if (document.activeElement) {
            document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
            }));
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
