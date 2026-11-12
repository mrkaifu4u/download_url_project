// Backend test for the Video Downloader Apps Script (Code.gs).
// Runs the REAL Code.gs in node with an in-memory fake Spreadsheet,
// verifying the v2 security fixes: RBAC, created-user login, blocked
// login refusal, lockout, password-reset sync, and backup/restore.
const fs = require('fs');
const vm = require('vm');
const crypto = require('crypto');

const src = fs.readFileSync('/home/hatch/workspace/video-downloader/apps-script/Code.gs', 'utf8');

/* ---------- fake Spreadsheet ---------- */
class FakeRange {
  constructor(sheet, r, c, nr, nc) { this.s = sheet; this.r = r; this.c = c; this.nr = nr || 1; this.nc = nc || 1; }
  getValues() {
    const out = [];
    for (let i = 0; i < this.nr; i++) {
      const row = [];
      for (let j = 0; j < this.nc; j++) row.push(this.s.getCell(this.r + i, this.c + j));
      out.push(row);
    }
    return out;
  }
  setValues(values) {
    values.forEach((row, i) => row.forEach((v, j) => this.s.setCell(this.r + i, this.c + j, v)));
  }
  setValue(v) { this.s.setCell(this.r, this.c, v); }
}
class FakeSheet {
  constructor(name) { this.name = name; this.rows = []; }
  getLastRow() { return this.rows.length; }
  appendRow(row) { this.rows.push(row.slice()); }
  deleteRow(n) { this.rows.splice(n - 1, 1); }
  clearContents() { this.rows = []; }
  getRange(r, c, nr, nc) { return new FakeRange(this, r, c, nr, nc); }
  setCell(r, c, v) {
    while (this.rows.length < r) this.rows.push([]);
    const row = this.rows[r - 1];
    while (row.length < c) row.push('');
    row[c - 1] = v;
  }
  getCell(r, c) {
    const row = this.rows[r - 1];
    return row && row[c - 1] !== undefined ? row[c - 1] : '';
  }
}
const ss = {
  sheets: {},
  getSheetByName(n) { return this.sheets[n] || null; },
  insertSheet(n) { this.sheets[n] = new FakeSheet(n); return this.sheets[n]; }
};

function parseCsv(text) {
  const rows = []; let row = [], cur = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur); cur = ''; rows.push(row); row = []; }
    else if (ch !== '\r') cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
function formatDate(d, tz, fmt) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d);
  const g = (t) => parts.find((p) => p.type === t).value;
  return fmt === 'dd/MM/yyyy' ? g('day') + '/' + g('month') + '/' + g('year') : g('hour') + ':' + g('minute') + ':' + g('second');
}

const sandbox = {
  console,
  SpreadsheetApp: { getActiveSpreadsheet: () => ss },
  Utilities: {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    computeDigest: (alg, str) => [...crypto.createHash('sha256').update(str, 'utf8').digest()].map((b) => (b > 127 ? b - 256 : b)),
    formatDate,
    getUuid: () => crypto.randomUUID(),
    parseCsv
  },
  ContentService: {
    MimeType: { JSON: 'JSON' },
    createTextOutput: (s) => ({ setMimeType: () => ({ getContent: () => s }) })
  }
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox);

function post(data) {
  const out = sandbox.doPost({ postData: { contents: JSON.stringify(data) } });
  return JSON.parse(out.getContent());
}
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

/* ---------- 1. setup ---------- */
check('setupStatus: no admin yet', post({ action: 'setupStatus' }).setupDone === false);
check('setupAdmin creates first admin', post({ action: 'setupAdmin', email: 'owner@example.com', password: 'ownerpass123' }).ok === true);
check('setupAdmin again rejected', post({ action: 'setupAdmin', email: 'x@example.com', password: 'password123' }).ok === false);
check('unauthenticated stats rejected', post({ action: 'stats' }).ok === false);

/* ---------- 2. lockout (on a throwaway email — never the owner's) ---------- */
for (let i = 1; i <= 4; i++) {
  const r = post({ action: 'login', email: 'probe@example.com', password: 'wrongpass' });
  check('wrong password #' + i + ' rejected', r.ok === false && r.error === 'Invalid email or password.', JSON.stringify(r));
}
const fifth = post({ action: 'login', email: 'probe@example.com', password: 'wrongpass' });
check('5th wrong password triggers lockout', fifth.ok === false && /Too many failed/.test(fifth.error), JSON.stringify(fifth));
const locked = post({ action: 'login', email: 'probe@example.com', password: 'wrongpass' });
check('login while locked refused', locked.ok === false && /try again in/.test(locked.error), JSON.stringify(locked));
// Simulate 16 minutes passing by moving LockedUntil into the past.
ss.sheets['dl_lockouts'].rows[1][3] = Date.now() - 1000;
const afterLock = post({ action: 'login', email: 'probe@example.com', password: 'wrongpass' });
check('login works again after lockout expires', afterLock.ok === false && afterLock.error === 'Invalid email or password.', JSON.stringify(afterLock));

/* ---------- 3. owner login + create users ---------- */
const owner = post({ action: 'login', email: 'owner@example.com', password: 'ownerpass123' });
check('owner login ok, role super_admin', owner.ok === true && owner.role === 'super_admin' && owner.mustChange === true, JSON.stringify(owner));
const ownerTok = owner.token;
check('validate owner token', post({ action: 'validate', token: ownerTok }).valid === true);
const mkAdmin = post({ action: 'createUser', token: ownerTok, name: 'Ana Admin', email: 'ana@example.com', role: 'admin', password: 'anapass123' });
check('super_admin creates admin user', mkAdmin.ok === true, JSON.stringify(mkAdmin));
const mkViewer = post({ action: 'createUser', token: ownerTok, name: 'Vic Viewer', email: 'vic@example.com', role: 'user', password: 'vicpass123' });
check('super_admin creates viewer user', mkViewer.ok === true, JSON.stringify(mkViewer));
check('duplicate email rejected', post({ action: 'createUser', token: ownerTok, name: 'Dup', email: 'ana@example.com', role: 'admin', password: 'anapass123' }).ok === false);

/* ---------- 4. BUG FIX: created users CAN log in now ---------- */
const ana = post({ action: 'login', email: 'ana@example.com', password: 'anapass123' });
check('created admin CAN log in (was broken)', ana.ok === true && ana.role === 'admin', JSON.stringify(ana));
const anaTok = ana.token;
const vic = post({ action: 'login', email: 'vic@example.com', password: 'vicpass123' });
check('created viewer CAN log in (was broken)', vic.ok === true && vic.role === 'user', JSON.stringify(vic));
const vicTok = vic.token;

/* ---------- 5. RBAC: admin (rank 1) ---------- */
check('admin cannot create users', post({ action: 'createUser', token: anaTok, name: 'No', email: 'no@example.com', role: 'user', password: 'nopass123' }).ok === false);
check('admin cannot delete users', post({ action: 'deleteUser', token: anaTok, id: mkViewer.id }).ok === false);
check('admin cannot restore', post({ action: 'restore', token: anaTok, backup: {}, confirm: true }).ok === false);
check('admin cannot change roles', post({ action: 'updateUser', token: anaTok, id: mkViewer.id, role: 'admin' }).ok === false);
check('admin cannot touch super_admin record', post({ action: 'updateUser', token: anaTok, id: post({ action: 'users', token: ownerTok }).users.find((u) => u.email === 'owner@example.com').id, blocked: true }).ok === false);
check('admin cannot reset super_admin password', post({ action: 'resetUserPassword', token: anaTok, id: post({ action: 'users', token: ownerTok }).users.find((u) => u.email === 'owner@example.com').id, password: 'hackedpass1' }).ok === false);
check('admin CAN block a viewer', post({ action: 'updateUser', token: anaTok, id: mkViewer.id, blocked: true }).ok === true, JSON.stringify(post({ action: 'users', token: ownerTok })));
check('admin CAN change settings', post({ action: 'settingsSet', token: anaTok, settings: { appName: 'Test App' } }).ok === true);
check('admin CAN back up', post({ action: 'backup', token: anaTok }).ok === true);
check('admin cannot block own account', post({ action: 'updateUser', token: anaTok, id: mkAdmin.id, blocked: true }).ok === false);

/* ---------- 6. blocked login refused ---------- */
const vicBlocked = post({ action: 'login', email: 'vic@example.com', password: 'vicpass123' });
check('blocked user cannot log in (was broken)', vicBlocked.ok === false && /blocked/i.test(vicBlocked.error), JSON.stringify(vicBlocked));
check('owner unblocks viewer', post({ action: 'updateUser', token: ownerTok, id: mkViewer.id, blocked: false }).ok === true);
const vic2 = post({ action: 'login', email: 'vic@example.com', password: 'vicpass123' });
check('unblocked viewer can log in again', vic2.ok === true, JSON.stringify(vic2));

/* ---------- 7. RBAC: viewer (rank 0, read-only) ---------- */
check('viewer CAN read stats', post({ action: 'stats', token: vicTok }).ok === true);
check('viewer CAN read logs', post({ action: 'logs', token: vicTok }).ok === true);
check('viewer CAN read audit', post({ action: 'audit', token: vicTok }).ok === true);
check('viewer CAN list users', post({ action: 'users', token: vicTok }).ok === true);
check('viewer cannot change settings', post({ action: 'settingsSet', token: vicTok, settings: { appName: 'Hacked' } }).ok === false);
check('viewer cannot update users', post({ action: 'updateUser', token: vicTok, id: mkAdmin.id, blocked: true }).ok === false);
check('viewer cannot back up', post({ action: 'backup', token: vicTok }).ok === false);
check('viewer cannot change accounts', post({ action: 'accountsSet', token: vicTok, accounts: [] }).ok === false);
check('viewer CAN change own password', post({ action: 'changePassword', token: vicTok, oldPassword: 'vicpass123', newPassword: 'vicnewpass1' }).ok === true);
const vic3 = post({ action: 'login', email: 'vic@example.com', password: 'vicnewpass1' });
check('viewer login works with new own password', vic3.ok === true, JSON.stringify(vic3));

/* ---------- 8. BUG FIX: password reset actually changes the login ---------- */
check('owner resets viewer password', post({ action: 'resetUserPassword', token: ownerTok, id: mkViewer.id, password: 'vicreset99' }).ok === true);
check('old viewer password no longer works', post({ action: 'login', email: 'vic@example.com', password: 'vicnewpass1' }).ok === false);
const vic4 = post({ action: 'login', email: 'vic@example.com', password: 'vicreset99' });
check('new viewer password works (was broken)', vic4.ok === true, JSON.stringify(vic4));
check('old viewer session killed by reset', post({ action: 'validate', token: vicTok }).ok === false);

/* ---------- 9. delete user removes login too ---------- */
check('owner deletes viewer', post({ action: 'deleteUser', token: ownerTok, id: mkViewer.id }).ok === true);
check('deleted viewer cannot log in', post({ action: 'login', email: 'vic@example.com', password: 'vicreset99' }).ok === false);
check('deleted viewer gone from list', post({ action: 'users', token: ownerTok }).users.every((u) => u.email !== 'vic@example.com'));
check('owner cannot delete self', post({ action: 'deleteUser', token: ownerTok, id: post({ action: 'users', token: ownerTok }).users.find((u) => u.email === 'owner@example.com').id }).ok === false);

/* ---------- 10. backup + restore round-trip ---------- */
post({ action: 'logDownload', token: ownerTok }); // no-op: legacy path needs no action; skip
const bk = post({ action: 'backup', token: ownerTok });
check('backup returns snapshots for all tabs', bk.ok === true && bk.backup && typeof bk.backup['downloader_data'] === 'string' && typeof bk.backup['dl_users'] === 'string', JSON.stringify(Object.keys(bk.backup || {})));
const usersBefore = post({ action: 'users', token: ownerTok }).users.length;
// Corrupt the users tab, then restore.
ss.sheets['dl_users'].rows = [ss.sheets['dl_users'].rows[0]];
check('users tab emptied (simulated loss)', post({ action: 'users', token: ownerTok }).users.length === 0);
const badRestore = post({ action: 'restore', token: ownerTok, backup: { dl_users: 'Wrong,Headers\n1,2' }, confirm: true });
check('restore with wrong headers rejected', badRestore.ok === false && /columns do not match/.test(badRestore.error), JSON.stringify(badRestore));
check('failed restore changed nothing', post({ action: 'users', token: ownerTok }).users.length === 0);
const noConfirm = post({ action: 'restore', token: ownerTok, backup: bk.backup });
check('restore without confirm rejected', noConfirm.ok === false && /confirmation/.test(noConfirm.error), JSON.stringify(noConfirm));
const rs = post({ action: 'restore', token: ownerTok, backup: bk.backup, confirm: true });
check('restore succeeds', rs.ok === true && rs.restored && rs.restored['dl_users'] === usersBefore, JSON.stringify(rs));
check('users back after restore', post({ action: 'users', token: ownerTok }).users.length === usersBefore);
const anaAfter = post({ action: 'login', email: 'ana@example.com', password: 'anapass123' });
check('admin login still works after restore', anaAfter.ok === true, JSON.stringify(anaAfter));
check('owner session survived restore (sessions not restored)', post({ action: 'validate', token: ownerTok }).valid === true);

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
