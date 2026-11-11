/**
 * Video Downloader — Google Apps Script backend (admin + download logger)
 * ==========================================================================
 * Bound script for the spreadsheet "portfolio_webiste_database".
 * Tabs used (created on demand with headers):
 *   downloader_data  — download log (existing, do NOT change columns)
 *   dl_admin         — Email | Salt | Hash | Role | MustChange | Created | LastLogin
 *   dl_users         — ID | Name | Email | Role | Active | Blocked | Created | LastLogin | Downloads | Device | Salt | Hash
 *   dl_sessions      — TokenHash | Email | Expires | Created
 *   dl_audit         — Date | Time | Admin | Action | Result | Details
 *   dl_settings      — Key | Value
 *   dl_accounts      — Platform | Name | Status | LastChecked | Note
 *
 * SECURITY — read this before deploying:
 *   - NO passwords are stored in plain text, in this file, or in the repo.
 *     Passwords are hashed with SHA-256 + a per-account random salt
 *     (Utilities.computeDigest). Only Email + Salt + Hash are stored.
 *   - The FIRST admin is created ONLY through the setup screen in
 *     admin.html (action=setupAdmin), and ONLY while no admin exists.
 *     There is no default password anywhere in this file.
 *   - Login returns a random session token; only its SHA-256 hash is
 *     stored (dl_sessions) with a 30-minute sliding expiry. Every admin
 *     action validates the token server-side. The static site cannot
 *     protect admin.html's URL (GitHub Pages has no route protection),
 *     so the backend MUST reject every unauthenticated call — it does.
 *   - This is Apps Script + Sheets auth, not enterprise auth. For
 *     stronger guarantees (server-side route protection, rate limiting,
 *     brute-force lockout beyond the Sheet) a dedicated backend is needed.
 *   - The RapidAPI key is NOT stored in the Sheet. API connection tests
 *     run from the browser (admin.js) using the built-in key.
 *   - NEVER allow SQL execution from the browser — there is no SQL here
 *     at all; the "database" is Sheet tabs accessed only by this script.
 *
 * DEPLOY
 *   1. Open the spreadsheet "portfolio_webiste_database".
 *   2. Extensions > Apps Script. Paste this file as Code.gs.
 *   3. Deploy > New deployment > Web app.
 *        Execute as: Me
 *        Who has access: Anyone
 *   4. Copy the Web app URL (…/exec).
 *   5. In the main app: Settings > Google Apps Script web-app URL
 *      (this also enables download logging), OR paste it on the
 *      admin login screen — admin.html reads it from there.
 *   6. Open admin.html (…/download_url_project/admin.html). If no
 *      admin exists yet you get the "Create first admin" setup screen.
 *      Create the admin, then log in. You are forced to change the
 *      initial password on first login.
 *
 * NOTES
 *   - No spreadsheet ID is hardcoded — getActiveSpreadsheet() is the
 *     right file when bound to the spreadsheet.
 *   - The web app receives JSON as text/plain (no preflight) and
 *     returns JSON; admin.js reads the response.
 *   - Legacy download logging: POSTing a download entry with NO
 *     "action" field appends a row to downloader_data exactly as
 *     before (same 12 columns). Do not change those columns.
 *   - Dates are stored en-GB (DD/MM/YYYY), matching the app.
 */

var LOG_SHEET = 'downloader_data';
var LOG_HEADERS = ['S.No', 'Date', 'Time', 'Device', 'Platform', 'Tool',
  'Video URL', 'Quality', 'Location', 'Latitude', 'Longitude',
  'Google Maps Link'];

var ADMIN_SHEET = 'dl_admin';
var ADMIN_HEADERS = ['Email', 'Salt', 'Hash', 'Role', 'MustChange', 'Created', 'LastLogin'];

var USERS_SHEET = 'dl_users';
var USERS_HEADERS = ['ID', 'Name', 'Email', 'Role', 'Active', 'Blocked', 'Created', 'LastLogin', 'Downloads', 'Device', 'Salt', 'Hash'];

var SESSIONS_SHEET = 'dl_sessions';
var SESSIONS_HEADERS = ['TokenHash', 'Email', 'Expires', 'Created'];

var AUDIT_SHEET = 'dl_audit';
var AUDIT_HEADERS = ['Date', 'Time', 'Admin', 'Action', 'Result', 'Details'];

var SETTINGS_SHEET = 'dl_settings';
var SETTINGS_HEADERS = ['Key', 'Value'];

var ACCOUNTS_SHEET = 'dl_accounts';
var ACCOUNTS_HEADERS = ['Platform', 'Name', 'Status', 'LastChecked', 'Note'];

var KNOWN_TABS = [LOG_SHEET, USERS_SHEET, ADMIN_SHEET, AUDIT_SHEET, SETTINGS_SHEET, ACCOUNTS_SHEET, SESSIONS_SHEET];
var SESSION_MS = 30 * 60 * 1000; // 30 minutes, sliding
var PROVIDERS = ['instagram', 'youtube', 'allinone'];

/* ---------------- sheet helpers ---------------- */

function getSheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0 && headers) sheet.appendRow(headers);
  return sheet;
}

function headersOf_(name) {
  if (name === LOG_SHEET) return LOG_HEADERS;
  if (name === ADMIN_SHEET) return ADMIN_HEADERS;
  if (name === USERS_SHEET) return USERS_HEADERS;
  if (name === SESSIONS_SHEET) return SESSIONS_HEADERS;
  if (name === AUDIT_SHEET) return AUDIT_HEADERS;
  if (name === SETTINGS_SHEET) return SETTINGS_HEADERS;
  if (name === ACCOUNTS_SHEET) return ACCOUNTS_HEADERS;
  return null;
}

function readRows_(name) {
  var sheet = getSheet_(name, headersOf_(name));
  var last = sheet.getLastRow();
  if (last < 2) return [];
  var headers = headersOf_(name);
  var values = sheet.getRange(2, 1, last - 1, headers.length).getValues();
  return values.map(function (r) {
    var o = {};
    headers.forEach(function (h, i) { o[h] = r[i]; });
    o.__row = values.indexOf(r) + 2;
    return o;
  });
}

function findRow_(name, header, value) {
  var rows = readRows_(name);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][header]).toLowerCase() === String(value).toLowerCase()) return rows[i];
  }
  return null;
}

function deleteRowByNumber_(name, rowNum) {
  getSheet_(name, headersOf_(name)).deleteRow(rowNum);
}

function updateCells_(name, rowNum, patch) {
  var sheet = getSheet_(name, headersOf_(name));
  var headers = headersOf_(name);
  Object.keys(patch).forEach(function (h) {
    var col = headers.indexOf(h) + 1;
    if (col > 0) sheet.getRange(rowNum, col).setValue(patch[h]);
  });
}

function tzNow_() {
  var now = new Date();
  return {
    date: Utilities.formatDate(now, 'Asia/Kolkata', 'dd/MM/yyyy'),
    time: Utilities.formatDate(now, 'Asia/Kolkata', 'HH:mm:ss'),
    ms: now.getTime()
  };
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------------- crypto ---------------- */

function sha256Hex_(str) {
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8);
  return digest.map(function (b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function hashPassword_(salt, password) {
  return sha256Hex_(salt + '::' + password);
}

function newSalt_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}

function newToken_() {
  return Utilities.getUuid() + '-' + Utilities.getUuid() + '-' + new Date().getTime().toString(36);
}

/* ---------------- audit ---------------- */

function audit_(admin, action, result, details) {
  try {
    var n = tzNow_();
    getSheet_(AUDIT_SHEET, AUDIT_HEADERS).appendRow([n.date, n.time, admin || '', action || '', result || '', details || '']);
  } catch (e) { /* audit must never break the action itself */ }
}

/* ---------------- settings store ---------------- */

function settingsGetAll_() {
  var out = {};
  readRows_(SETTINGS_SHEET).forEach(function (r) {
    var v = r.Value;
    try { out[r.Key] = JSON.parse(v); } catch (e) { out[r.Key] = v; }
  });
  return out;
}

function settingsSet_(key, value) {
  var sheet = getSheet_(SETTINGS_SHEET, SETTINGS_HEADERS);
  var stored = (typeof value === 'string') ? value : JSON.stringify(value);
  var row = findRow_(SETTINGS_SHEET, 'Key', key);
  if (row) updateCells_(SETTINGS_SHEET, row.__row, { Value: stored });
  else sheet.appendRow([key, stored]);
}

/* ---------------- auth ---------------- */

function adminCount_() {
  return readRows_(ADMIN_SHEET).length;
}

function requireAuth_(data) {
  var token = data && data.token;
  if (!token) return { ok: false, error: 'Not authenticated — please log in.' };
  var hash = sha256Hex_(token);
  var sess = findRow_(SESSIONS_SHEET, 'TokenHash', hash);
  if (!sess) return { ok: false, error: 'Session invalid — please log in again.' };
  var expires = Number(sess.Expires) || 0;
  if (new Date().getTime() > expires) {
    try { deleteRowByNumber_(SESSIONS_SHEET, sess.__row); } catch (e) {}
    return { ok: false, error: 'Session expired — please log in again.' };
  }
  // Sliding expiry: extend 30 minutes on each validated call.
  updateCells_(SESSIONS_SHEET, sess.__row, { Expires: new Date().getTime() + SESSION_MS });
  var admin = findRow_(ADMIN_SHEET, 'Email', sess.Email);
  return { ok: true, email: sess.Email, role: admin ? admin.Role : 'admin', mustChange: admin ? String(admin.MustChange) === 'true' : false };
}

function issueSession_(email) {
  var token = newToken_();
  var now = new Date().getTime();
  getSheet_(SESSIONS_SHEET, SESSIONS_HEADERS).appendRow([sha256Hex_(token), email, now + SESSION_MS, now]);
  return token;
}

/* ---------------- download log (legacy, unchanged) ---------------- */

function logDownload_(data) {
  var sheet = getSheet_(LOG_SHEET, LOG_HEADERS);
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
  return { ok: true, row: serial + 1 };
}

/* ---------------- stats / logs ---------------- */

function parseGbDate_(s) {
  // DD/MM/YYYY -> Date (or null)
  var m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

function stats_() {
  var users = readRows_(USERS_SHEET);
  var logs = readRows_(LOG_SHEET);
  var todayKey = tzNow_().date;
  var byPlatform = { instagram: 0, youtube: 0, facebook: 0, allinone: 0 };
  var byDate = {};
  var today = 0;
  logs.forEach(function (r) {
    var p = String(r.Platform || '').toLowerCase();
    if (p === 'facebook') byPlatform.facebook++;
    else if (p === 'youtube') byPlatform.youtube++;
    else if (p === 'allinone') byPlatform.allinone++;
    else if (p) byPlatform.instagram++;
    if (String(r.Date) === todayKey) today++;
    var d = String(r.Date || '');
    if (d) byDate[d] = (byDate[d] || 0) + 1;
  });
  return {
    ok: true,
    users: {
      total: users.length,
      active: users.filter(function (u) { return String(u.Active) === 'true' && String(u.Blocked) !== 'true'; }).length,
      blocked: users.filter(function (u) { return String(u.Blocked) === 'true'; }).length
    },
    downloads: { total: logs.length, today: today },
    apiAccounts: PROVIDERS.length,
    byPlatform: byPlatform,
    byDate: Object.keys(byDate).sort().map(function (d) { return { date: d, count: byDate[d] }; }),
    totalRows: logs.length + users.length + readRows_(AUDIT_SHEET).length
  };
}

function logsQuery_(data) {
  var rows = readRows_(LOG_SHEET);
  var search = String(data.search || '').toLowerCase();
  var platform = String(data.platform || '').toLowerCase();
  var device = String(data.device || '').toLowerCase();
  var from = data.dateFrom ? parseGbDate_(data.dateFrom) : null;
  var to = data.dateTo ? parseGbDate_(data.dateTo) : null;
  var filtered = rows.filter(function (r) {
    if (platform && String(r.Platform || '').toLowerCase() !== platform) return false;
    if (device && String(r.Device || '').toLowerCase().indexOf(device) === -1) return false;
    if (search) {
      var hay = [r['Video URL'], r.Tool, r.Platform, r.Location, r.Device].join(' ').toLowerCase();
      if (hay.indexOf(search) === -1) return false;
    }
    var d = parseGbDate_(r.Date);
    if (from && (!d || d < from)) return false;
    if (to && (!d || d > to)) return false;
    return true;
  });
  filtered.reverse(); // newest first
  var page = Math.max(1, Number(data.page) || 1);
  var pageSize = Math.min(100, Math.max(5, Number(data.pageSize) || 25));
  var total = filtered.length;
  var slice = filtered.slice((page - 1) * pageSize, page * pageSize);
  return {
    ok: true,
    rows: slice.map(function (r) {
      return {
        sno: r['S.No'], date: r.Date, time: r.Time, device: r.Device,
        platform: r.Platform, tool: r.Tool, url: r['Video URL'],
        quality: r.Quality, city: r.Location, lat: r.Latitude, lng: r.Longitude,
        mapsLink: r['Google Maps Link']
      };
    }),
    total: total, page: page, pages: Math.max(1, Math.ceil(total / pageSize))
  };
}

/* ---------------- CSV ---------------- */

function csvEscape_(v) {
  var s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function tabCsv_(name) {
  var headers = headersOf_(name);
  if (!headers) return null;
  var rows = readRows_(name);
  var lines = [headers.map(csvEscape_).join(',')];
  rows.forEach(function (r) {
    lines.push(headers.map(function (h) { return csvEscape_(r[h]); }).join(','));
  });
  return lines.join('\n');
}

/* ---------------- HTTP entry points ---------------- */

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) || '';
  if (action === 'count') {
    var sheet = getSheet_(LOG_SHEET, LOG_HEADERS);
    return json_({ ok: true, count: Math.max(0, sheet.getLastRow() - 1) });
  }
  if (action === 'ping') {
    return json_({ ok: true, service: 'video-downloader-admin', setupDone: adminCount_() > 0 });
  }
  return json_({ ok: true, message: 'Video Downloader logger + admin backend is running. POST a download entry to log it, or an {action} for admin calls.' });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return json_({ ok: false, error: 'Empty request.' });
    var data = JSON.parse(e.postData.contents);

    // Legacy path: a download entry has no "action" — log it exactly as before.
    if (!data.action) return json_(logDownload_(data));

    var action = String(data.action);
    var n = tzNow_();

    /* ----- public (no token) ----- */
    if (action === 'setupStatus') {
      return json_({ ok: true, setupDone: adminCount_() > 0 });
    }
    if (action === 'setupAdmin') {
      if (adminCount_() > 0) return json_({ ok: false, error: 'An admin already exists. Log in instead.' });
      var email = String(data.email || '').trim().toLowerCase();
      var pw = String(data.password || '');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json_({ ok: false, error: 'Enter a valid email address.' });
      if (pw.length < 8) return json_({ ok: false, error: 'Password must be at least 8 characters.' });
      var salt = newSalt_();
      getSheet_(ADMIN_SHEET, ADMIN_HEADERS).appendRow([email, salt, hashPassword_(salt, pw), 'super_admin', 'true', n.date + ' ' + n.time, '']);
      getSheet_(USERS_SHEET, USERS_HEADERS).appendRow([Utilities.getUuid(), email.split('@')[0], email, 'super_admin', 'true', 'false', n.date + ' ' + n.time, '', 0, '', '', '']);
      audit_(email, 'setup_admin', 'ok', 'First admin created');
      return json_({ ok: true });
    }
    if (action === 'login') {
      var lemail = String(data.email || '').trim().toLowerCase();
      var admin = findRow_(ADMIN_SHEET, 'Email', lemail);
      if (!admin || hashPassword_(admin.Salt, String(data.password || '')) !== admin.Hash) {
        audit_(lemail, 'login', 'failed', 'Invalid credentials');
        return json_({ ok: false, error: 'Invalid email or password.' });
      }
      var token = issueSession_(lemail);
      updateCells_(ADMIN_SHEET, admin.__row, { LastLogin: n.date + ' ' + n.time });
      var urow = findRow_(USERS_SHEET, 'Email', lemail);
      if (urow) updateCells_(USERS_SHEET, urow.__row, { LastLogin: n.date + ' ' + n.time });
      audit_(lemail, 'login', 'ok', 'Admin logged in');
      return json_({ ok: true, token: token, email: lemail, role: admin.Role, mustChange: String(admin.MustChange) === 'true', expiresIn: SESSION_MS });
    }

    /* ----- everything below needs a valid session ----- */
    var auth = requireAuth_(data);
    if (!auth.ok) return json_(auth);
    var who = auth.email;

    if (action === 'validate') {
      return json_({ ok: true, valid: true, email: who, role: auth.role, mustChange: auth.mustChange });
    }
    if (action === 'logout') {
      var srow = findRow_(SESSIONS_SHEET, 'TokenHash', sha256Hex_(data.token));
      if (srow) deleteRowByNumber_(SESSIONS_SHEET, srow.__row);
      audit_(who, 'logout', 'ok', 'Admin logged out');
      return json_({ ok: true });
    }
    if (action === 'changePassword') {
      var adm = findRow_(ADMIN_SHEET, 'Email', who);
      if (!adm || hashPassword_(adm.Salt, String(data.oldPassword || '')) !== adm.Hash) {
        audit_(who, 'change_password', 'failed', 'Old password did not match');
        return json_({ ok: false, error: 'Current password is incorrect.' });
      }
      if (String(data.newPassword || '').length < 8) return json_({ ok: false, error: 'New password must be at least 8 characters.' });
      var nsalt = newSalt_();
      updateCells_(ADMIN_SHEET, adm.__row, { Salt: nsalt, Hash: hashPassword_(nsalt, String(data.newPassword)), MustChange: 'false' });
      audit_(who, 'change_password', 'ok', 'Password changed');
      return json_({ ok: true });
    }
    if (action === 'stats') return json_(stats_());
    if (action === 'logs') return json_(logsQuery_(data));

    if (action === 'users') {
      var users = readRows_(USERS_SHEET).map(function (u) {
        return { id: u.ID, name: u.Name, email: u.Email, role: u.Role, active: String(u.Active) === 'true', blocked: String(u.Blocked) === 'true', created: u.Created, lastLogin: u.LastLogin, downloads: Number(u.Downloads) || 0, device: u.Device || '' };
      });
      return json_({ ok: true, users: users });
    }
    if (action === 'createUser') {
      var cemail = String(data.email || '').trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cemail)) return json_({ ok: false, error: 'Enter a valid email address.' });
      if (findRow_(USERS_SHEET, 'Email', cemail)) return json_({ ok: false, error: 'A user with this email already exists.' });
      if (String(data.password || '').length < 8) return json_({ ok: false, error: 'Password must be at least 8 characters.' });
      var csalt = newSalt_();
      var cid = Utilities.getUuid();
      getSheet_(USERS_SHEET, USERS_HEADERS).appendRow([cid, String(data.name || cemail.split('@')[0]), cemail, String(data.role || 'user'), 'true', 'false', n.date + ' ' + n.time, '', 0, '', csalt, hashPassword_(csalt, String(data.password))]);
      audit_(who, 'create_user', 'ok', cemail + ' (' + String(data.role || 'user') + ')');
      return json_({ ok: true, id: cid });
    }
    if (action === 'updateUser') {
      var uu = findRow_(USERS_SHEET, 'ID', String(data.id || ''));
      if (!uu) return json_({ ok: false, error: 'User not found.' });
      var patch = {};
      if (data.name != null) patch.Name = String(data.name);
      if (data.email != null) patch.Email = String(data.email).trim().toLowerCase();
      if (data.role != null) patch.Role = String(data.role);
      if (data.active != null) patch.Active = data.active ? 'true' : 'false';
      if (data.blocked != null) patch.Blocked = data.blocked ? 'true' : 'false';
      updateCells_(USERS_SHEET, uu.__row, patch);
      audit_(who, 'update_user', 'ok', uu.Email + ' -> ' + JSON.stringify(patch));
      return json_({ ok: true });
    }
    if (action === 'resetUserPassword') {
      var ru = findRow_(USERS_SHEET, 'ID', String(data.id || ''));
      if (!ru) return json_({ ok: false, error: 'User not found.' });
      if (String(data.password || '').length < 8) return json_({ ok: false, error: 'Password must be at least 8 characters.' });
      var rsalt = newSalt_();
      updateCells_(USERS_SHEET, ru.__row, { Salt: rsalt, Hash: hashPassword_(rsalt, String(data.password)) });
      audit_(who, 'reset_user_password', 'ok', ru.Email);
      return json_({ ok: true });
    }
    if (action === 'deleteUser') {
      var du = findRow_(USERS_SHEET, 'ID', String(data.id || ''));
      if (!du) return json_({ ok: false, error: 'User not found.' });
      if (String(du.Email).toLowerCase() === who) return json_({ ok: false, error: 'You cannot delete your own admin account.' });
      deleteRowByNumber_(USERS_SHEET, du.__row);
      audit_(who, 'delete_user', 'ok', du.Email);
      return json_({ ok: true });
    }
    if (action === 'settingsGet') {
      return json_({ ok: true, settings: settingsGetAll_() });
    }
    if (action === 'settingsSet') {
      var incoming = data.settings || {};
      Object.keys(incoming).forEach(function (k) { settingsSet_(k, incoming[k]); });
      audit_(who, 'update_settings', 'ok', Object.keys(incoming).join(', '));
      return json_({ ok: true });
    }
    if (action === 'audit') {
      var arows = readRows_(AUDIT_SHEET).reverse();
      var apage = Math.max(1, Number(data.page) || 1);
      var asize = Math.min(100, Math.max(5, Number(data.pageSize) || 25));
      return json_({
        ok: true,
        rows: arows.slice((apage - 1) * asize, apage * asize).map(function (r) {
          return { date: r.Date, time: r.Time, admin: r.Admin, action: r.Action, result: r.Result, details: r.Details };
        }),
        total: arows.length, page: apage, pages: Math.max(1, Math.ceil(arows.length / asize))
      });
    }
    if (action === 'tabs') {
      return json_({
        ok: true,
        tabs: KNOWN_TABS.map(function (t) {
          return { name: t, rows: Math.max(0, getSheet_(t, headersOf_(t)).getLastRow() - 1) };
        })
      });
    }
    if (action === 'exportTab') {
      var csv = tabCsv_(String(data.tab || ''));
      if (csv === null) return json_({ ok: false, error: 'Unknown tab.' });
      return json_({ ok: true, csv: csv, name: String(data.tab) });
    }
    if (action === 'backup') {
      var snap = {};
      KNOWN_TABS.forEach(function (t) { snap[t] = tabCsv_(t) || ''; });
      var stamp = n.date + ' ' + n.time;
      var settings = settingsGetAll_();
      var history = settings.backups || [];
      history.unshift({ at: stamp, rows: stats_().totalRows });
      settingsSet_('backups', history.slice(0, 10));
      settingsSet_('lastBackup', stamp);
      audit_(who, 'backup', 'ok', 'Snapshot of ' + KNOWN_TABS.length + ' tabs, ' + stats_().totalRows + ' rows');
      return json_({ ok: true, backup: snap, exportedAt: stamp });
    }
    if (action === 'accountsGet') {
      var accs = readRows_(ACCOUNTS_SHEET);
      if (!accs.length) {
        var defaults = [
          { Platform: 'instagram', Name: 'Instagram', Status: 'Not connected', LastChecked: '', Note: 'Downloads use RapidAPI — no account login.' },
          { Platform: 'youtube', Name: 'YouTube', Status: 'Not connected', LastChecked: '', Note: 'Downloads use RapidAPI — no account login.' },
          { Platform: 'facebook', Name: 'Facebook', Status: 'Not connected', LastChecked: '', Note: 'Downloads use RapidAPI — no account login.' }
        ];
        defaults.forEach(function (a) { getSheet_(ACCOUNTS_SHEET, ACCOUNTS_HEADERS).appendRow([a.Platform, a.Name, a.Status, a.LastChecked, a.Note]); });
        accs = readRows_(ACCOUNTS_SHEET);
      }
      return json_({
        ok: true,
        accounts: accs.map(function (a) {
          return { platform: a.Platform, name: a.Name, status: a.Status, lastChecked: a.LastChecked || '', note: a.Note || '' };
        })
      });
    }
    if (action === 'accountsSet') {
      var list = data.accounts || [];
      var sheet = getSheet_(ACCOUNTS_SHEET, ACCOUNTS_HEADERS);
      list.forEach(function (a) {
        var row = findRow_(ACCOUNTS_SHEET, 'Platform', String(a.platform || ''));
        var vals = { Name: String(a.name || a.platform), Status: String(a.status || 'Not connected'), LastChecked: String(a.lastChecked || ''), Note: String(a.note || '') };
        if (row) updateCells_(ACCOUNTS_SHEET, row.__row, vals);
        else sheet.appendRow([String(a.platform), vals.Name, vals.Status, vals.LastChecked, vals.Note]);
      });
      audit_(who, 'update_accounts', 'ok', list.map(function (a) { return a.platform + ':' + a.status; }).join(', '));
      return json_({ ok: true });
    }

    return json_({ ok: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}
