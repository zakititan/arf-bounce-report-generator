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

  function getFormulaBarText(el) {
    if (!el) return '';
    if (el.value !== undefined) return el.value.trim();
    return (el.textContent || el.innerText || '').trim();
  }

  async function readCell(nameBox, formulaBar, cellRef) {
    nameBox.focus();
    nameBox.select();
    document.execCommand('insertText', false, cellRef);
    nameBox.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
    }));
    await sleep(250);

    var val = getFormulaBarText(formulaBar);
    if (val) return val;

    // Fallback: try reading from other formula bar selectors
    try {
      var fbInput = document.querySelector('input[id*="formula-bar"], input[class*="formula"], .waffle-formula-bar-input');
      if (fbInput) {
        var val2 = getFormulaBarText(fbInput);
        log('readCell fallback fbInput: "' + val2 + '"');
        return val2;
      }
    } catch (e) {}

    // Fallback: read active element value
    try {
      var active = document.activeElement;
      if (active && active !== nameBox) {
        var val3 = getFormulaBarText(active);
        if (val3) {
          log('readCell fallback activeEl: "' + val3 + '"');
          return val3;
        }
      }
    } catch (e) {}

    log('readCell: no value found for ' + cellRef);
    return '';
  }

  async function getNextEmptyRow() {
    log('getNextEmptyRow: binary search on column B');

    var nameBox = document.querySelector(
      '#t-name-box-input, #t-name-box, .docs-name-box-input, [aria-label="Name Box"]'
    );
    var formulaBar = document.querySelector(
      '#t-formula-bar-input, .docs-bar-formula-input, [aria-label="Formula bar"], input[id*="formula-bar"], input[class*="formula"], .waffle-formula-bar-input'
    );

    if (!nameBox) {
      log('Name Box not found - defaulting to row 3');
      return 3;
    }

    if (!formulaBar) {
      log('WARNING: Formula bar not found - readCell will try fallbacks');
    } else {
      log('Formula bar found: ' + formulaBar.tagName + '#' + formulaBar.id + '.' + formulaBar.className);
    }

    var today = new Date().toLocaleDateString('en-US');
    log('Today: ' + today);

    // Step 1: Find lastRow via Ctrl+End
    nameBox.focus();
    nameBox.select();
    document.execCommand('insertText', false, 'B3');
    nameBox.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
    }));
    await sleep(150);

    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'End', code: 'End', keyCode: 35, which: 35, ctrlKey: true, bubbles: true
    }));
    await sleep(300);

    var endRef = nameBox.value;
    log('Ctrl+End landed on: ' + endRef);
    var endMatch = endRef && endRef.match(/(\d+)$/);
    var lastRow = endMatch ? parseInt(endMatch[1], 10) : 3;
    log('lastRow: ' + lastRow);

    // Step 2: Binary search column B for today's date
    var lo = 3;
    var hi = lastRow;
    var foundRow = null;
    var lastNonEmptyRow = 2; // tracks last row with any data in column B

    while (lo <= hi) {
      var mid = Math.floor((lo + hi) / 2);
      var val = await readCell(nameBox, formulaBar, 'B' + mid);
      log('BS row ' + mid + ': "' + val + '"');

      if (val === today) {
        foundRow = mid;
        lastNonEmptyRow = mid;
        lo = mid + 1;
      } else if (val === '') {
        hi = mid - 1;
      } else {
        lastNonEmptyRow = mid;
        var cellDate = new Date(val);
        var todayDate = new Date(today);
        if (cellDate < todayDate) {
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
    }

    if (foundRow !== null) {
      // Step 3: Scan downward from foundRow to find exact last today-row
      var lastTodayRow = foundRow;
      for (var r = foundRow + 1; r <= foundRow + 50; r++) {
        var v = await readCell(nameBox, formulaBar, 'B' + r);
        if (v === today) {
          lastTodayRow = r;
        } else {
          break;
        }
      }
      log('Last today row: ' + lastTodayRow + ', writing to row: ' + (lastTodayRow + 1));
      return lastTodayRow + 1;
    }

    // Step 4: Today's date not found - append after last non-empty row in column B
    log('Today not found - appending after last non-empty row in column B: ' + lastNonEmptyRow);
    return lastNonEmptyRow + 1;
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
        var col = String.fromCharCode(66 + i); // B, C, D, E, F, G
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

        // Tab to next column (including after last value to save it)
        if (document.activeElement) {
          document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Tab', code: 'Tab', keyCode: 9, which: 9, bubbles: true
          }));
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
