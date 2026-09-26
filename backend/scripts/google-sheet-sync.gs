// Google Apps Script: keeps the dashboard in sync with this spreadsheet.
//
// Install (once), from the spreadsheet:
//   1. Extensions > Apps Script. Replace everything with this file. Save.
//   2. Put the dashboard's WRITE_API_KEY below (this project is private to
//      your Google account; never commit the real key to the repo).
//   3. Pick "install" in the function dropdown and press Run. Approve the
//      permissions prompt (Advanced > Go to project, since it's your own
//      unverified script).
//
// It then checks the "All events" tab every minute and pushes it to the
// dashboard when it changed, plus a heartbeat every 10 minutes. The server
// matches rows by row_id, so pushing the same data twice is harmless.

const WRITE_API_KEY = 'PASTE_WRITE_API_KEY_HERE';
const API_URL = 'https://api-production-2ace4.up.railway.app/sync/sheet?via=apps-script';
const TAB_NAME = 'All events';
const HEARTBEAT_MINUTES = 10;

function install() {
  for (const trigger of ScriptApp.getProjectTriggers()) ScriptApp.deleteTrigger(trigger);
  ScriptApp.newTrigger('syncIfChanged').timeBased().everyMinutes(1).create();
  PropertiesService.getScriptProperties().deleteAllProperties();
  syncNow();
}

// Runs every minute: push only when the tab changed or a heartbeat is due.
function syncIfChanged() {
  const csv = readTabAsCsv();
  const props = PropertiesService.getScriptProperties();
  const hash = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, csv));
  const lastPush = Number(props.getProperty('lastPushMs') || 0);
  const heartbeatDue = Date.now() - lastPush > HEARTBEAT_MINUTES * 60 * 1000;
  if (hash === props.getProperty('lastHash') && !heartbeatDue) return;
  push(csv);
  props.setProperties({ lastHash: hash, lastPushMs: String(Date.now()) });
}

// Manual "sync right now" (also what install() calls).
function syncNow() {
  const csv = readTabAsCsv();
  push(csv);
  const hash = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, csv));
  PropertiesService.getScriptProperties().setProperties({ lastHash: hash, lastPushMs: String(Date.now()) });
}

function readTabAsCsv() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TAB_NAME);
  if (!sheet) throw new Error(`No tab named "${TAB_NAME}"`);
  // Display values match what File > Download > CSV produces (e.g. dates as
  // YYYY-MM-DD, booleans as TRUE/FALSE).
  return sheet.getDataRange().getDisplayValues()
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n');
}

function csvCell(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function push(csv) {
  if (!WRITE_API_KEY || WRITE_API_KEY.startsWith('PASTE_')) throw new Error('Set WRITE_API_KEY at the top of the script');
  const res = UrlFetchApp.fetch(API_URL, {
    method: 'post',
    contentType: 'text/csv',
    payload: csv,
    headers: { Authorization: `Bearer ${WRITE_API_KEY}` },
    muteHttpExceptions: true,
  });
  const body = res.getContentText();
  if (res.getResponseCode() !== 200) throw new Error(`Dashboard sync failed (${res.getResponseCode()}): ${body}`);
  console.log(`Synced: ${body}`);
}
