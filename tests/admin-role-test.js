// Admin role-UI test (jsdom): a viewer must see no write buttons, a
// super_admin must see them all. Backend calls are mocked — the real
// enforcement lives in Code.gs and is covered by backend-test.js.
const fs = require('fs');
const { JSDOM } = require('jsdom');

const dir = '/home/hatch/workspace/video-downloader';
const html = fs.readFileSync(dir + '/admin.html', 'utf8');
const configJs = fs.readFileSync(dir + '/config.js', 'utf8');
const adminJs = fs.readFileSync(dir + '/admin.js', 'utf8');

let CURRENT_ROLE = 'user';
const USERS = [
  { id: 'u1', name: 'Ana Admin', email: 'ana@example.com', role: 'admin', active: true, blocked: false, created: '12/11/2026', lastLogin: 'Never', downloads: 0, device: '' },
  { id: 'u2', name: 'Ollie Owner', email: 'owner@example.com', role: 'super_admin', active: true, blocked: false, created: '11/11/2026', lastLogin: '12/11/2026', downloads: 0, device: '' }
];
function mockFetch(url, opts) {
  const u = String(url);
  if (u.includes('action=ping')) return Promise.resolve({ json: async () => ({ ok: true }) });
  let body = {};
  try { body = JSON.parse(opts.body); } catch {}
  const R = (o) => Promise.resolve({ json: async () => o });
  switch (body.action) {
    case 'setupStatus': return R({ ok: true, setupDone: true });
    case 'validate': return R({ ok: true, valid: true, email: 't@example.com', role: CURRENT_ROLE, mustChange: false });
    case 'stats': return R({ ok: true, users: { total: 2, active: 2, blocked: 0 }, downloads: { total: 5, today: 1 }, apiAccounts: 3, byPlatform: { instagram: 5 }, byDate: [{ date: '12/11/2026', count: 5 }], totalRows: 10 });
    case 'settingsGet': return R({ ok: true, settings: {} });
    case 'tabs': return R({ ok: true, tabs: [{ name: 'downloader_data', rows: 5 }] });
    case 'logs': return R({ ok: true, rows: [], total: 0, page: 1, pages: 1 });
    case 'users': return R({ ok: true, users: USERS });
    case 'accountsGet': return R({ ok: true, accounts: [] });
    default: return R({ ok: false, error: 'Unknown action: ' + body.action });
  }
}

async function runAs(role) {
  CURRENT_ROLE = role;
  const dom = new JSDOM(html, { url: 'https://mrkaifu4u.github.io/download_url_project/admin.html', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const { document } = window;
  const ctxMock = new Proxy({}, {
    get(t, prop) { if (prop in t) return t[prop]; return (...args) => ctxMock; },
    set(t, prop, v) { t[prop] = v; return true; }
  });
  window.HTMLCanvasElement.prototype.getContext = () => ctxMock;
  window.fetch = mockFetch;
  window.localStorage.setItem('vd_admin_backend', 'https://example.com/exec');
  window.localStorage.setItem('vd_settings', JSON.stringify({ appsScriptUrl: 'https://example.com/exec' }));
  window.localStorage.setItem('vd_admin_session', JSON.stringify({ token: 'tok-' + role, email: 't@example.com', role }));
  window.eval(configJs);
  window.eval(adminJs);
  // Wait for enterApp (dashboard section visible + identity filled).
  const $ = (id) => document.getElementById(id);
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 20));
    if ($('adminIdentity') && $('adminIdentity').textContent.includes('t@example.com')) break;
  }
  return { window, document, $ };
}

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}
function waitFor(fn, label, tries) {
  return new Promise((resolve) => {
    let n = 0;
    const t = setInterval(() => {
      n++;
      if (fn() || n > (tries || 100)) { clearInterval(t); resolve(fn()); }
    }, 20);
  });
}

(async () => {
  /* ---------- viewer ---------- */
  const v = await runAs('user');
  check('viewer: logged in as user', v.$('adminIdentity').textContent.includes('user'));
  check('viewer: create-user card hidden', v.$('createUserCard').style.display === 'none');
  check('viewer: settings save disabled', v.document.querySelector('#appSettingsForm button[type="submit"]').disabled === true);
  check('viewer: backup disabled', v.$('dbBackupBtn').disabled === true);
  check('viewer: restore disabled', v.$('dbRestoreBtn').disabled === true);
  check('viewer: key save disabled', v.$('keySaveBtn').disabled === true);
  v.document.querySelector('#adminNav .nav-item[data-section="users"]').click();
  await waitFor(() => v.document.querySelectorAll('#usersTable tbody tr').length === 2, 'users load');
  check('viewer: users table shows 2 rows', v.document.querySelectorAll('#usersTable tbody tr').length === 2);
  check('viewer: no action buttons, View only shown', v.document.querySelectorAll('#usersTable button[data-act]').length === 0 && v.document.querySelector('#usersTable').textContent.includes('View only'));
  v.document.querySelector('#adminNav .nav-item[data-section="api"]').click();
  await waitFor(() => v.document.querySelectorAll('#apiRows .api-row').length > 0, 'api load');
  check('viewer: API test buttons disabled', Array.from(v.document.querySelectorAll('#apiRows [data-test]')).every((b) => b.disabled));
  check('viewer: API save-limit buttons disabled', Array.from(v.document.querySelectorAll('#apiRows [data-save-limit]')).every((b) => b.disabled));
  check('viewer: key state shows built-in', v.$('rapidKeyState').textContent.includes('built-in'));

  /* ---------- super_admin ---------- */
  const s = await runAs('super_admin');
  check('super: logged in as super_admin', s.$('adminIdentity').textContent.includes('super_admin'));
  check('super: create-user card visible', s.$('createUserCard').style.display !== 'none');
  check('super: settings save enabled', s.document.querySelector('#appSettingsForm button[type="submit"]').disabled === false);
  check('super: backup enabled', s.$('dbBackupBtn').disabled === false);
  check('super: restore enabled', s.$('dbRestoreBtn').disabled === false);
  check('super: key save enabled', s.$('keySaveBtn').disabled === false);
  s.document.querySelector('#adminNav .nav-item[data-section="users"]').click();
  await waitFor(() => s.document.querySelectorAll('#usersTable tbody tr').length === 2, 'users load');
  check('super: delete buttons present', s.document.querySelectorAll('#usersTable button[data-act="delete"]').length === 2);
  check('super: edit buttons present', s.document.querySelectorAll('#usersTable button[data-act="edit"]').length === 2);
  // Edit the super_admin row: role select must include super_admin (no silent demotion).
  s.document.querySelector('#usersTable button[data-act="edit"][data-id="u2"]').click();
  await waitFor(() => s.$('mRole') !== null, 'modal open');
  const opts = Array.from(s.$('mRole').options).map((o) => o.value);
  check('super: edit modal role list has all 3 roles', opts.includes('user') && opts.includes('admin') && opts.includes('super_admin'), opts.join(','));
  check('super: edit modal pre-selects super_admin', s.$('mRole').value === 'super_admin', s.$('mRole').value);
  // Key override save writes to vd_settings.
  s.$('overrideRapidKey').value = 'test-key-1234';
  s.$('keySaveBtn').click();
  const saved = JSON.parse(s.window.localStorage.getItem('vd_settings'));
  check('super: key override saved to vd_settings', saved.rapidapiKey === 'test-key-1234');
  check('super: key state shows masked override', s.$('rapidKeyState').textContent.includes('1234'));
  s.$('keyClearBtn').click();
  const cleared = JSON.parse(s.window.localStorage.getItem('vd_settings'));
  check('super: key override cleared', !cleared.rapidapiKey && s.$('rapidKeyState').textContent.includes('built-in'));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
