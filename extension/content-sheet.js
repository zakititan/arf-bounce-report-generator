// extension/content-sheet.js
// Runs on docs.google.com/spreadsheets/* - listens for append-sheet-row messages
// and writes data to the sheet using keyboard navigation + input automation

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

  // Robust text input: tries execCommand first, then sets value directly + input event
  async function typeText(el, text) {
    if (!el) return false;
    el.focus();
    el.select();

    // Method 1: execCommand (works on Chrome)
    try {
      document.execCommand('insertText', false, text);
      if (el.value === text || el.textContent === text) return true;
    } catch (e) {}

    // Method 2: Set value directly + dispatch input event (works on Edge)
    try {
      var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      nativeInputValueSetter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      if (el.value === text) return true;
    } catch (e) {}

    // Method 3: Clipboard paste
    try {
      await navigator.clipboard.writeText(text);
      el.focus();
      el.select();
      document.execCommand('paste');
      if (el.value === text) return true;
    } catch (e) {}

    // Method 4: Set value + dispatch React-compatible event
    try {
      el.value = text;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
      el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
      return true;
    } catch (e) {}

    log('typeText: all methods failed for: ' + text);
    return false;
  }

  // Type text into the active cell editor (not Name Box)
  async function typeInCell(text) {
    if (!text) return true;
    var el = document.activeElement;
    if (!el) return false;

    // Method 1: execCommand (works on Chrome)
    try {
      document.execCommand('insertText', false, text);
      return true;
    } catch (e) {}

    // Method 2: Clipboard paste into active element
    try {
      await navigator.clipboard.writeText(text);
      document.execCommand('paste');
      return true;
    } catch (e) {}

    // Method 3: Input event with data property
    try {
      el.dispatchEvent(new InputEvent('beforeinput', { inputType: 'insertText', data: text, bubbles: true, cancelable: true }));
      el.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: text, bubbles: true }));
      return true;
    } catch (e) {}

    log('typeInCell: all methods failed for: ' + text);
    return false;
  }

  function pressKey(el, key, code, keyCode, modifiers) {
    if (!el) return;
    var opts = { key: key, code: code, keyCode: keyCode, which: keyCode, bubbles: true };
    if (modifiers) {
      if (modifiers.ctrl) opts.ctrlKey = true;
      if (modifiers.meta) opts.metaKey = true;
      if (modifiers.shift) opts.shiftKey = true;
    }
    el.dispatchEvent(new KeyboardEvent('keydown', opts));
  }

  async function readCell(nameBox, formulaBar, cellRef) {
    await typeText(nameBox, cellRef);
    pressKey(nameBox, 'Enter', 'Enter', 13);
    await sleep(300);

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

  async function getLastRowViaFormula(nameBox, formulaBar) {
    // Navigate to A1 as scratch cell
    nameBox.focus();
    nameBox.select();
    document.execCommand('insertText', false, 'A1');
    nameBox.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
    }));
    await sleep(300);

    // Enter edit mode
    if (document.activeElement) {
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'F2', code: 'F2', keyCode: 113, which: 113, bubbles: true
      }));
    }
    await sleep(150);

    // Type the formula — Sheets evaluates it live in the formula bar
    // IFERROR covers dates stored as numbers (1E+99) and as text ("zzzzz")
    // Returns the actual row number of the last filled cell in column B
    document.execCommand('insertText', false,
      '=IFERROR(MATCH(1E+99,B:B,1),MATCH("zzzzz",B:B,1))'
    );
    await sleep(600);

    // Read the evaluated result from the formula bar
    var rawVal = getFormulaBarText(formulaBar);
    log('MATCH formula bar raw: "' + rawVal + '"');

    // Fallback formula bar selectors
    if (!rawVal || rawVal.startsWith('=')) {
      try {
        var fbInput = document.querySelector(
          'input[id*="formula-bar"], input[class*="formula"], .waffle-formula-bar-input'
        );
        if (fbInput) rawVal = getFormulaBarText(fbInput);
      } catch (e) {}
    }

    // Escape WITHOUT committing — formula discarded, A1 stays unchanged
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true
    }));
    await sleep(150);

    var lastRow = parseInt(rawVal, 10);
    if (isNaN(lastRow) || rawVal.startsWith('=')) {
      log('MATCH read failed (got "' + rawVal + '") — returning null for fallback');
      return null;
    }

    log('MATCH result: lastRow = ' + lastRow);
    return lastRow;
  }

  async function getNextEmptyRow() {
    log('getNextEmptyRow: binary search on column B');

    var nameBox = document.querySelector(
      '#t-name-box-input, #t-name-box, .docs-name-box-input, [aria-label="Name Box"], [aria-label="\u03a3 Name Box"], [data-goog-aria-label="Name Box"]'
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

    // Step 1: Find lastRow via MATCH formula — O(1), no modifier keys, works on Edge/macOS
    var lastRow = await getLastRowViaFormula(nameBox, formulaBar);

    if (lastRow === null) {
      // Formula bar read failed entirely — short linear scan as last resort
      log('Formula fallback: scanning downward from row 3');
      lastRow = 3;
      for (var probe = 3; probe <= 50; probe++) {
        var pv = await readCell(nameBox, formulaBar, 'B' + probe);
        if (pv === '') break;
        lastRow = probe;
      }
    }
    log('lastRow: ' + lastRow);

    // Step 2: Binary search column B for today's date
    var lo = 3;
    var hi = lastRow;
    var foundRow = null;
    var lastNonEmptyRow = 2;

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

    log('Today not found - appending after last non-empty row in column B: ' + lastNonEmptyRow);
    return lastNonEmptyRow + 1;
  }

  async function appendRow(data) {
    try {
      var nextRow = await getNextEmptyRow();
      log('Target row: ' + nextRow);

      var nameBox = document.querySelector(
        '#t-name-box-input, #t-name-box, .docs-name-box-input, [aria-label="Name Box"], [aria-label="\u03a3 Name Box"], [data-goog-aria-label="Name Box"]'
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

        // Navigate to cell via Name Box
        await typeText(nameBox, cellRef);
        pressKey(nameBox, 'Enter', 'Enter', 13);
        await sleep(400);

        // Enter edit mode with F2
        pressKey(document.activeElement, 'F2', 'F2', 113);
        await sleep(250);

        // Type value into cell
        if (values[i]) {
          await typeInCell(values[i]);
          await sleep(250);
        }

        // Tab to next column (including after last value to save it)
        pressKey(document.activeElement, 'Tab', 'Tab', 9);
        await sleep(250);
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
