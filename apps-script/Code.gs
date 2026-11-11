/**
 * Video Downloader — Google Apps Script backend
 * ============================================================
 * Logs every fetch to the Google Sheet "portfolio_webiste_database",
 * tab "downloader_data".
 *
 * Columns (row 1 header — create them if the tab is empty):
 *   S.No | Date | Time | Device | Platform | Tool | Video URL |
 *   Quality | Location | Latitude | Longitude | Google Maps Link
 *
 * SETUP
 *   1. Open the spreadsheet "portfolio_webiste_database".
 *   2. Extensions > Apps Script. Paste this file as Code.gs.
 *   3. Deploy > New deployment > Web app.
 *        Execute as: Me
 *        Who has access: Anyone
 *   4. Copy the Web app URL (…/exec) and paste it in the downloader
 *      app under Settings > Google Apps Script web-app URL.
 *   5. Press "Test Sheet connection" in the app — it calls
 *      doGet?action=count and should report the row count.
 *
 * NOTES
 *   - No API keys here. No spreadsheet ID hardcoded — this script
 *     runs bound to the spreadsheet, so getActiveSpreadsheet() is
 *     the right file. (If you run it standalone, use
 *     SpreadsheetApp.openById('…') instead.)
 *   - S.No is the next row number (last row), so rows stay serial.
 *   - The web app receives JSON as text/plain because the static
 *     site posts cross-origin without a preflight.
 */

var SHEET_NAME = 'downloader_data';
var HEADERS = ['S.No', 'Date', 'Time', 'Device', 'Platform', 'Tool',
  'Video URL', 'Quality', 'Location', 'Latitude', 'Longitude',
  'Google Maps Link'];

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);
  return sheet;
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var sheet = getSheet_();
    var serial = sheet.getLastRow(); // header is row 1, so first data row = 1
    sheet.appendRow([
      serial,
      data.date || '',
      data.time || '',
      data.device || '',
      data.platform || '',
      data.tool || '',
      data.video_url || '',
      data.quality || '',
      data.city || '',
      data.lat || '',
      data.lng || '',
      data.mapsLink || ''
    ]);
    return json_({ ok: true, row: serial + 1 });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  // ?action=count  -> { ok, count } = data rows this month (approx: all rows)
  // Kept simple on purpose: the sheet is small. For a strict
  // current-month count, filter column B (Date) in the sheet itself.
  var action = (e && e.parameter && e.parameter.action) || '';
  if (action === 'count') {
    var sheet = getSheet_();
    return json_({ ok: true, count: Math.max(0, sheet.getLastRow() - 1) });
  }
  return json_({ ok: true, message: 'Video Downloader logger is running. POST a fetch entry to log it.' });
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
