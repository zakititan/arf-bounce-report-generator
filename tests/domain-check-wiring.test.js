import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The Domain Check panel is new UI, and the two bugs this project has shipped
// in browser-bridge code were both invisible to a green test suite because
// the wiring lived in scripts/app.js, which has no DOM harness. These tests
// cover what CAN be checked without a browser: the panel's markup exists, the
// dispatch reaches it, and the extension bridge accepts the new message type.

const APP_JS = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'app.js'),
  'utf8'
);
const INDEX_HTML = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'index.html'),
  'utf8'
);

describe('Domain Check panel markup', () => {
  it('has a tab button pointing at the panel', () => {
    assert.match(INDEX_HTML, /data-tab="domain-check"/);
    assert.match(INDEX_HTML, /aria-controls="panel-domain-check"/);
  });

  it('has the panel itself, inside the tab content', () => {
    assert.match(INDEX_HTML, /id="panel-domain-check" class="tab-panel"/);
  });

  it('has an account field that accepts a domain or an email', () => {
    assert.match(INDEX_HTML, /id="domaincheck-account"/);
  });

  it('has a run button and a clear button', () => {
    assert.match(INDEX_HTML, /id="domaincheck-run-btn"/);
    assert.match(INDEX_HTML, /data-action="domain-check"/);
    assert.match(INDEX_HTML, /data-action="clear" data-panel="domain-check"/);
  });

  it('has a region chip, because the status APIs require a region', () => {
    assert.match(INDEX_HTML, /id="domaincheck-region-chip"/);
  });

  it('has a report container with a headline and a rows container', () => {
    assert.match(INDEX_HTML, /id="domaincheck-report"/);
    assert.match(INDEX_HTML, /id="domaincheck-headline"/);
    assert.match(INDEX_HTML, /id="domaincheck-rows"/);
  });

  it('has no JIRA or unsuspend control — the panel is read-only', () => {
    const panel = INDEX_HTML.slice(
      INDEX_HTML.indexOf('id="panel-domain-check"'),
      INDEX_HTML.indexOf('</section>', INDEX_HTML.indexOf('id="panel-domain-check"'))
    );
    assert.doesNotMatch(panel, /data-action="create-jira"/);
    assert.doesNotMatch(panel, /data-action="unsuspend"/);
    assert.doesNotMatch(panel, /data-action="log-sheet"/);
  });
});

describe('Domain Check panel wiring in scripts/app.js', () => {
  it('registers the panel in TAB_DATA_TAB so the tab and panel ids resolve', () => {
    assert.match(APP_JS, /domaincheck:\s*'domain-check'/);
  });

  it('dispatches the run action to the panel runner', () => {
    assert.match(APP_JS, /case 'domain-check':\s*\n\s*runDomainCheck\(target\);/);
  });

  it('dispatches the clear action to the panel clear', () => {
    assert.match(APP_JS, /panel === 'domain-check'\)\s*clearDomainCheck\(\);/);
  });

  it('defines the panel runner and the clear', () => {
    assert.match(APP_JS, /async function runDomainCheck\(btn\)/);
    assert.match(APP_JS, /function clearDomainCheck\(opts\)/);
  });

  it('sends the new bridge message type', () => {
    assert.match(APP_JS, /type:\s*'REPORT_GENERATOR_DOMAIN_STATUS'/);
  });

  it('waits for the region before asking Abuse Desk, since the API requires it', () => {
    // The region lookup and the status request must be sequenced, not parallel.
    assert.match(APP_JS, /regionPromise\.then\(region => requestDomainStatus\(account, region\)\)/);
  });

  it('converts the internal region token to the real region name', () => {
    // Regression: the panel used to pass lookupMx's 'na'/'eu' straight to the
    // status API, which answers a bad region with a valid but EMPTY body
    // ({"data": []}) — so the check silently produced no status and the row
    // read as a bare "Unknown". The conversion must go through adRegionParam.
    assert.match(APP_JS, /return adRegionParam\(r\.region\)/);
    assert.match(APP_JS, /return adRegionParam\('na'\)/);
    assert.doesNotMatch(
      APP_JS,
      /regionPromise\.then\(region => requestDomainStatus\(account, region\)\)[\s\S]{0,200}return r\.region/,
      'the raw region token must not reach the status request'
    );
  });

  it('runs every check it advertises', () => {
    for (const fn of ['fetchWhois', 'fetchWebsiteCheck', 'fetchMailRecords', 'fetchDkimCheck',
                      'fetchLaravelCheck', 'fetchXmlrpcCheck', 'fetchWordPressCheck']) {
      assert.match(APP_JS, new RegExp(fn + '\\('), fn + ' is not called');
    }
  });

  it('does not let one failing check abort the others', () => {
    assert.match(APP_JS, /Promise\.allSettled\(\[/);
  });

  it('renders detail text as text, never as HTML', () => {
    // A hostile API string must not be able to inject markup into the report.
    const render = APP_JS.slice(
      APP_JS.indexOf('function renderDomainCheckRow'),
      APP_JS.indexOf('function setDomainCheckPending')
    );
    assert.match(render, /detail\.textContent =/);
    assert.match(render, /labelEl\.textContent = label/);
    assert.doesNotMatch(render, /innerHTML =/);
  });
});
