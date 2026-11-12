/* ==========================================================================
   Video Downloader — admin.js
   Admin frontend only. Every admin action goes through the Apps Script
   backend (POST, Content-Type: text/plain, JSON {action, ...}).
   No dummy data: every number comes from the backend or localStorage and
   shows 0 / an empty state when there is nothing. Storage is Google
   Sheets — row counts only, never GB figures.
   The first admin is created ONLY via the setupAdmin backend action.
   No credential is ever invented or stored in this file.
   ========================================================================== */
(function () {
  'use strict';
  const CFG = window.VD_CONFIG || { API_HOSTS: {}, DEFAULT_LIMITS: {}, DEFAULT_RAPIDAPI_KEY: '' };
  const $ = (id) => document.getElementById(id);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /* ---------- storage keys ---------- */
  const LS_BACKEND = 'vd_admin_backend';   // admin backend URL
  const LS_MAIN_SETTINGS = 'vd_settings';  // main app settings (has appsScriptUrl)
  const LS_SESSION = 'vd_admin_session';   // remembered session (localStorage, Remember me only)
  const LS_APP_SETTINGS = 'vd_app_settings'; // {appName, maintenance, limits, disabledHosts, lastBackup}
  const LS_API_TEST = 'vd_admin_api_test'; // last real API test result
  const LS_QUOTA = 'vd_quota';             // main app quota, per month per bucket
  const SESSION_MS = 30 * 60 * 1000;       // 30-minute inactivity expiry

  /* ---------- state ---------- */
  let backendUrl = '';
  let backendOk = false;
  let token = '';
  let adminEmail = '';
  let adminRole = '';
  let sessionExpiresAt = 0;
  let countdownTimer = null;
  let inactivityTimer = null;
  let currentSection = 'dashboard';
  let lastStats = null;
  let lastSettings = null;
  let lastTabs = [];
  let selectedDbTab = '';
  let selectedDbCsv = '';
  let trendDays = 7;
  let expandedLogKey = '';

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function num(n) { const v = Number(n); return Number.isFinite(v) ? v : 0; }
  function fmt(n) { return num(n).toLocaleString('en-US'); }
  function show(el, on) { if (el) el.style.display = on ? '' : 'none'; }
  function showStatus(el, msg, kind) {
    if (!el) return;
    if (!msg) { el.style.display = 'none'; el.textContent = ''; return; }
    el.style.display = 'block';
    el.className = 'status show ' + (kind || 'info');
    el.textContent = msg;
  }
  function readJson(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? fallback : v; } catch { return fallback; }
  }
  function csvCell(v) {
    const s = String(v == null ? '' : v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function downloadFile(name, content, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([content], { type: type || 'text/plain' }));
    a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }
  function parseCsv(text) {
    // Minimal CSV parser (handles quoted cells with commas / newlines).
    const rows = []; let row = [], cur = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
        else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ',') { row.push(cur); cur = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cur); cur = ''; rows.push(row); row = [];
      } else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
  }
  function mapsLink(lat, lng) {
    if (lat === '' || lat == null || lng === '' || lng == null) return '';
    return 'https://maps.google.com/?q=' + encodeURIComponent(lat) + ',' + encodeURIComponent(lng);
  }

  /* ---------- backend ---------- */
  function getBackendUrl() {
    const saved = (localStorage.getItem(LS_BACKEND) || '').trim();
    if (saved) return saved;
    const main = readJson(LS_MAIN_SETTINGS, {});
    return (main.appsScriptUrl || '').trim();
  }
  function setBackendUrl(url) {
    backendUrl = (url || '').trim();
    if (backendUrl) localStorage.setItem(LS_BACKEND, backendUrl);
  }
  async function apiCall(action, params, withToken) {
    resetInactivity();
    const body = Object.assign({ action }, params || {});
    if (withToken !== false) body.token = token;
    const res = await fetch(backendUrl, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data && data.ok === false && isSessionError(data.error)) {
      await expireSession('Session expired — please log in again.');
      throw new Error('Session expired');
    }
    return data;
  }
  function isSessionError(err) {
    const s = String(err || '').toLowerCase();
    return /invalid session|session expired|unauthori|not logged in|invalid token|token expired/.test(s);
  }
  async function pingBackend() {
    const res = await fetch(backendUrl + (backendUrl.includes('?') ? '&' : '?') + 'action=ping');
    return res.json();
  }

  /* ---------- views ---------- */
  function showView(name) {
    show($('view-login'), name === 'login');
    show($('view-setup'), name === 'setup');
    show($('view-change'), name === 'change');
    show($('view-app'), name === 'app');
  }
  function updateBackendNotice() {
    const notice = $('backendNotice');
    const status = $('backendStatus');
    if (!backendUrl) {
      notice.style.display = 'block';
      notice.className = 'notice';
      notice.textContent = 'Admin backend not connected — deploy apps-script/Code.gs as a Web App and paste its URL in Admin Settings below.';
      if (status) status.textContent = 'No backend URL configured.';
      return false;
    }
    if (!backendOk) {
      notice.style.display = 'block';
      notice.className = 'notice';
      notice.textContent = 'Admin backend not connected — deploy apps-script/Code.gs as a Web App and paste its URL in Admin Settings below. The backend could not be reached at the saved URL.';
      if (status) status.textContent = 'Backend URL saved, but the ping failed — check the deployment.';
      return false;
    }
    notice.style.display = 'none';
    if (status) status.textContent = 'Backend connected.';
    return true;
  }

  /* ---------- session ---------- */
  function storeSession(tok, email, role, remember) {
    token = tok; adminEmail = email; adminRole = role;
    const payload = JSON.stringify({ token: tok, email, role });
    if (remember) localStorage.setItem(LS_SESSION, payload);
    else sessionStorage.setItem(LS_SESSION, payload);
    sessionStorage.setItem(LS_SESSION, payload); // session copy always exists for this tab
    if (!remember) localStorage.removeItem(LS_SESSION);
  }
  function loadStoredSession() {
    try {
      const raw = localStorage.getItem(LS_SESSION) || sessionStorage.getItem(LS_SESSION);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }
  function clearSession() {
    token = ''; adminEmail = ''; adminRole = '';
    sessionStorage.removeItem(LS_SESSION);
    localStorage.removeItem(LS_SESSION);
    stopTimers();
  }
  function startSessionTimers() {
    stopTimers();
    sessionExpiresAt = Date.now() + SESSION_MS;
    countdownTimer = setInterval(updateCountdown, 1000);
    inactivityTimer = setTimeout(() => expireSession('Session expired — please log in again.'), SESSION_MS);
    updateCountdown();
  }
  function stopTimers() {
    if (countdownTimer) clearInterval(countdownTimer);
    if (inactivityTimer) clearTimeout(inactivityTimer);
    countdownTimer = null; inactivityTimer = null;
  }
  function resetInactivity() {
    if (!token) return;
    sessionExpiresAt = Date.now() + SESSION_MS;
    if (inactivityTimer) clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => expireSession('Session expired — please log in again.'), SESSION_MS);
    updateCountdown();
  }
  function updateCountdown() {
    const el = $('sessionCountdown');
    if (!el || !token) return;
    const left = Math.max(0, sessionExpiresAt - Date.now());
    const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
    el.textContent = 'Session ' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    show($('sessionWarn'), left > 0 && left < 5 * 60 * 1000);
  }
  async function expireSession(msg) {
    const t = token;
    clearSession();
    if (t && backendUrl) { try { await fetch(backendUrl, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify({ action: 'logout', token: t }) }); } catch { /* already expired */ } }
    showView('login');
    updateBackendNotice();
    const m = $('sessionExpiredMsg');
    if (m) { m.style.display = 'block'; m.textContent = msg || 'Session expired — please log in again.'; }
  }
  async function logout() {
    const t = token;
    if (t && backendUrl) { try { await apiCall('logout', {}, true); } catch { /* ignore */ } }
    clearSession();
    showView('login');
    updateBackendNotice();
    showStatus($('loginError'), '');
    const m = $('sessionExpiredMsg');
    if (m) m.style.display = 'none';
  }

  /* ---------- auth flows ---------- */
  async function init() {
    backendUrl = getBackendUrl();
    const urlInput = $('backendUrlInput');
    if (urlInput) urlInput.value = backendUrl;
    // Ping first: login is REFUSED when there is no backend or ping fails.
    if (backendUrl) {
      try { const p = await pingBackend(); backendOk = !!(p && p.ok); } catch { backendOk = false; }
    }
    updateBackendNotice();
    if (!backendUrl || !backendOk) { showView('login'); return; }
    let setupDone = true;
    try {
      const st = await apiCall('setupStatus', {}, false);
      setupDone = !!(st && st.ok && st.setupDone);
    } catch { setupDone = true; }
    if (!setupDone) {
      $('setupBackendLine').textContent = 'Backend: ' + backendUrl;
      showView('setup');
      return;
    }
    const saved = loadStoredSession();
    if (saved && saved.token) {
      token = saved.token; adminEmail = saved.email || ''; adminRole = saved.role || '';
      try {
        const v = await apiCall('validate', {}, true);
        if (v && v.ok && v.valid) {
          adminEmail = v.email || adminEmail; adminRole = v.role || adminRole;
          if (v.mustChange) { showView('change'); return; }
          enterApp();
          return;
        }
      } catch { /* fall through to login */ }
      clearSession();
    }
    showView('login');
  }

  async function handleLogin(e) {
    e.preventDefault();
    showStatus($('loginError'), '');
    const m = $('sessionExpiredMsg'); if (m) m.style.display = 'none';
    if (!backendUrl || !backendOk) {
      showStatus($('loginError'), 'Login refused: the admin backend is not connected. Deploy apps-script/Code.gs as a Web App and paste its URL in Admin Settings below.', 'err');
      return;
    }
    const email = $('loginEmail').value.trim();
    const password = $('loginPassword').value;
    if (!email || !password) { showStatus($('loginError'), 'Enter your email and password.', 'err'); return; }
    const btn = $('loginBtn'); btn.disabled = true; btn.textContent = 'Logging in…';
    try {
      const r = await apiCall('login', { email, password }, false);
      if (!r || !r.ok) { showStatus($('loginError'), (r && r.error) || 'Invalid email or password', 'err'); return; }
      storeSession(r.token, r.email || email, r.role || '', $('rememberMe').checked);
      if (r.mustChange) { showView('change'); return; }
      enterApp();
    } catch (err) {
      if (String(err.message || '') !== 'Session expired') showStatus($('loginError'), 'Could not reach the backend — check the Apps Script URL.', 'err');
    } finally { btn.disabled = false; btn.textContent = '➜ Log In'; }
  }

  async function handleSetup(e) {
    e.preventDefault();
    showStatus($('setupError'), ''); showStatus($('setupOk'), '');
    const email = $('setupEmail').value.trim();
    const password = $('setupPassword').value;
    const confirm = $('setupConfirm').value;
    if (!email) { showStatus($('setupError'), 'Enter an email address.', 'err'); return; }
    if (password.length < 8) { showStatus($('setupError'), 'Password must be at least 8 characters.', 'err'); return; }
    if (password !== confirm) { showStatus($('setupError'), 'Passwords do not match.', 'err'); return; }
    const btn = $('setupBtn'); btn.disabled = true; btn.textContent = 'Creating…';
    try {
      const r = await apiCall('setupAdmin', { email, password }, false);
      if (!r || !r.ok) { showStatus($('setupError'), (r && r.error) || 'Could not create the admin.', 'err'); return; }
      showStatus($('setupOk'), 'Admin created. Please log in.', 'ok');
      setTimeout(() => { showView('login'); updateBackendNotice(); }, 900);
    } catch {
      showStatus($('setupError'), 'Could not reach the backend — check the Apps Script URL.', 'err');
    } finally { btn.disabled = false; btn.textContent = 'Create admin'; }
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    showStatus($('changeError'), '');
    const oldPassword = $('oldPassword').value;
    const newPassword = $('newPassword').value;
    const confirm = $('newConfirm').value;
    if (newPassword.length < 8) { showStatus($('changeError'), 'New password must be at least 8 characters.', 'err'); return; }
    if (newPassword !== confirm) { showStatus($('changeError'), 'New passwords do not match.', 'err'); return; }
    const btn = $('changeBtn'); btn.disabled = true; btn.textContent = 'Changing…';
    try {
      const r = await apiCall('changePassword', { oldPassword, newPassword }, true);
      if (!r || !r.ok) { showStatus($('changeError'), (r && r.error) || 'Could not change the password.', 'err'); return; }
      enterApp();
    } catch (err) {
      if (String(err.message || '') !== 'Session expired') showStatus($('changeError'), 'Could not reach the backend.', 'err');
    } finally { btn.disabled = false; btn.textContent = 'Change password & continue'; }
  }

  function enterApp() {
    startSessionTimers();
    const id = $('adminIdentity');
    if (id) id.innerHTML = '<b>' + esc(adminEmail || 'Admin') + '</b><span>' + esc(adminRole || 'admin') + '</span>';
    applyRoleUi();
    showView('app');
    showSection('dashboard');
  }

  /* ---------- roles (the backend enforces the real rules — this only
     keeps the UI honest so nobody clicks a button that will fail) ---------- */
  function roleRank() { const r = adminRole || 'user'; return r === 'super_admin' ? 2 : r === 'admin' ? 1 : 0; }
  function canWrite() { return roleRank() >= 1; }
  function isSuper() { return roleRank() >= 2; }
  function applyRoleUi() {
    const w = canWrite(), s = isSuper();
    const createCard = $('createUserCard'); if (createCard) createCard.style.display = s ? '' : 'none';
    const setBtn = document.querySelector('#appSettingsForm button[type="submit"]');
    if (setBtn) { setBtn.disabled = !w; setBtn.title = w ? '' : 'Your role is read-only.'; }
    const bk = $('dbBackupBtn'); if (bk) { bk.disabled = !w; bk.title = w ? '' : 'Your role is read-only.'; }
    const rs = $('dbRestoreBtn'); if (rs) { rs.disabled = !s; rs.title = s ? '' : 'Only a super admin can restore a backup.'; }
    const ra = $('restoreAccountsBtn'); if (ra) { ra.disabled = !w; ra.title = w ? '' : 'Your role is read-only.'; }
    ['keySaveBtn', 'keyClearBtn'].forEach((id) => { const b = $(id); if (b) { b.disabled = !w; b.title = w ? '' : 'Your role is read-only.'; } });
    ['overrideRapidKey', 'overrideScrappaKey'].forEach((id) => { const b = $(id); if (b) b.disabled = !w; });
  }

  /* ---------- navigation ---------- */
  const SECTION_TITLES = {
    dashboard: ['Admin <span>Dashboard</span>', 'Manage users, APIs, accounts, usage, and all application settings from one place.'],
    users: ['Users &amp; <span>Access</span>', 'Create, update, block/unblock users and reset passwords.'],
    api: ['API <span>Management</span>', 'RapidAPI hosts, keys, usage, limits and live tests.'],
    accounts: ['<span>Accounts</span>', 'Platform accounts (Instagram, YouTube, Facebook).'],
    usage: ['Usage &amp; <span>Reports</span>', 'Totals, platform and tool breakdowns, and remaining quota.'],
    logs: ['Download <span>Logs</span>', 'Every logged download from the Google Sheet.'],
    database: ['<span>Database</span>', 'Google Sheets tabs, exports, backups and row counts.'],
    settings: ['App <span>Settings</span>', 'App name, monthly limits, maintenance mode and backups.'],
    audit: ['Audit <span>Logs</span>', 'Admin actions recorded by the backend.']
  };
  function showSection(name) {
    currentSection = name;
    $$('.admin-section').forEach((s) => { s.style.display = s.id === 'section-' + name ? '' : 'none'; });
    $$('#adminNav .nav-item[data-section]').forEach((b) => b.classList.toggle('active', b.dataset.section === name));
    const t = SECTION_TITLES[name];
    if (t) { $('pageTitle').innerHTML = t[0]; $('pageSub').textContent = t[1]; }
    $('adminSidebar').classList.remove('open'); $('backdrop').classList.remove('show');
    showStatus($('appError'), '');
    if (name === 'dashboard') loadDashboard();
    else if (name === 'users') loadUsers();
    else if (name === 'api') loadApi();
    else if (name === 'accounts') loadAccounts();
    else if (name === 'usage') loadUsage();
    else if (name === 'logs') loadLogs();
    else if (name === 'database') loadDatabase();
    else if (name === 'settings') loadAppSettings();
    else if (name === 'audit') loadAudit(1);
  }
  function appError(msg) { showStatus($('appError'), msg || '', msg ? 'err' : 'info'); }

  /* ---------- shared logs table (12 columns, exact order) ---------- */
  const LOG_HEADERS = ['S.No', 'Date', 'Time', 'Device', 'Platform', 'Tool', 'Video URL', 'Quality', 'Location', 'Latitude', 'Longitude', 'Google Maps Link'];
  function logRowCells(r, i) {
    const link = mapsLink(r.lat, r.lng);
    return [
      esc(r.sno != null ? r.sno : i + 1),
      esc(r.date || ''), esc(r.time || ''), esc(r.device || ''),
      esc(r.platform || ''), esc(r.tool || ''),
      '<span class="url-cell" title="' + esc(r.url || '') + '">' + esc(r.url || '') + '</span>',
      esc(r.quality || '—'),
      esc(r.city || ''),
      esc(r.lat === '' || r.lat == null ? '—' : r.lat),
      esc(r.lng === '' || r.lng == null ? '—' : r.lng),
      link ? '<a href="' + esc(link) + '" target="_blank" rel="noopener">📍 View on Maps</a>' : '—'
    ];
  }
  function renderLogsTable(table, rows, opts) {
    const o = opts || {};
    let html = '<thead><tr>' + LOG_HEADERS.map((h) => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>';
    rows.forEach((r, i) => {
      const key = (r.sno != null ? r.sno : i + 1) + '|' + (r.date || '') + '|' + (r.time || '');
      html += '<tr class="log-row" data-key="' + esc(key) + '">' +
        logRowCells(r, i).map((c, j) => '<td data-label="' + LOG_HEADERS[j] + '">' + c + '</td>').join('') + '</tr>';
      if (o.expandable && expandedLogKey === key) {
        html += '<tr class="detail-row"><td colspan="12"><b>Full URL:</b> ' + esc(r.url || '—') +
          '<br><b>Device:</b> ' + esc(r.device || '—') + ' &nbsp; <b>Location:</b> ' + esc(r.city || '—') +
          (mapsLink(r.lat, r.lng) ? '<br><b>Maps:</b> <a href="' + esc(mapsLink(r.lat, r.lng)) + '" target="_blank" rel="noopener">' + esc(mapsLink(r.lat, r.lng)) + '</a>' : '<br><b>Maps:</b> — (no coordinates saved)') +
          '</td></tr>';
      }
    });
    html += '</tbody>';
    table.innerHTML = html;
    $$('.log-row', table).forEach((tr) => tr.addEventListener('click', (ev) => {
      if (ev.target.tagName === 'A') return;
      expandedLogKey = expandedLogKey === tr.dataset.key ? '' : tr.dataset.key;
      if (o.onToggle) o.onToggle();
    }));
  }
  function logsToCsv(rows) {
    const head = ['S.No', 'Date', 'Time', 'Device', 'Platform', 'Tool', 'Video URL', 'Quality', 'Location', 'Latitude', 'Longitude', 'Google Maps Link'];
    const lines = [head.join(',')];
    rows.forEach((r, i) => {
      lines.push([
        r.sno != null ? r.sno : i + 1, r.date || '', r.time || '', r.device || '', r.platform || '',
        r.tool || '', r.url || '', r.quality || '', r.city || '', r.lat || '', r.lng || '',
        mapsLink(r.lat, r.lng)
      ].map(csvCell).join(','));
    });
    return lines.join('\n');
  }
  function renderPager(el, page, pages, total, onPage) {
    if (!el) return;
    if (!pages || pages <= 1) { el.innerHTML = total ? '<span>Page 1 of 1 · ' + fmt(total) + ' row(s)</span>' : ''; return; }
    el.innerHTML = '<button class="btn ghost small" data-p="prev"' + (page <= 1 ? ' disabled' : '') + '>← Prev</button>' +
      '<span>Page ' + page + ' of ' + pages + ' · ' + fmt(total) + ' row(s)</span>' +
      '<button class="btn ghost small" data-p="next"' + (page >= pages ? ' disabled' : '') + '>Next →</button>';
    $$('button', el).forEach((b) => b.addEventListener('click', () => onPage(b.dataset.p === 'prev' ? page - 1 : page + 1)));
  }

  /* ---------- dashboard ---------- */
  let recentState = { page: 1, pages: 1, total: 0, rows: [] };
  async function loadDashboard() {
    try {
      const s = await apiCall('stats', {}, true);
      if (!s || !s.ok) { appError((s && s.error) || 'Could not load stats.'); return; }
      lastStats = s;
      $('statTotalUsers').textContent = fmt(s.users ? s.users.total : 0);
      $('statActiveUsers').textContent = fmt(s.users ? s.users.active : 0);
      $('statBlockedUsers').textContent = fmt(s.users ? s.users.blocked : 0);
      $('statTotalDownloads').textContent = fmt(s.downloads ? s.downloads.total : 0);
      $('statApiAccounts').textContent = fmt(s.apiAccounts != null ? s.apiAccounts : 0);
      $('statTodayDownloads').textContent = fmt(s.downloads ? s.downloads.today : 0);
      drawTrend(s.byDate || []);
      drawPlatform(s.byPlatform || {});
      const totalRows = num(s.totalRows);
      $('sysStorage').textContent = 'Google Sheets — ' + fmt(totalRows) + ' rows total';
      const test = readJson(LS_API_TEST, null);
      $('sysApiStatus').innerHTML = test
        ? (test.ok ? '<span class="badge green">Connected</span>' : '<span class="badge red">Failed</span>') + ' <span style="color:var(--muted);font-size:12px;">last test ' + esc(test.at || '') + '</span>'
        : '<span class="muted-pill">Not tested</span>';
      // Settings for last backup + tab counts.
      try {
        const g = await apiCall('settingsGet', {}, true);
        if (g && g.ok) { lastSettings = g.settings || {}; $('sysLastBackup').textContent = (g.settings && g.settings.lastBackup) || 'Never'; }
      } catch { $('sysLastBackup').textContent = 'Never'; }
      try {
        const t = await apiCall('tabs', {}, true);
        if (t && t.ok) {
          lastTabs = t.tabs || [];
          $('sysDb').innerHTML = '<span class="badge green">Healthy</span>';
          $('sysDbTabs').innerHTML = '<div class="tab-chips">' + lastTabs.map((x) => '<span class="chip">' + esc(x.name) + ' · ' + fmt(x.rows) + ' rows</span>').join('') + '</div>';
        } else { $('sysDb').innerHTML = '<span class="muted-pill">Unknown</span>'; }
      } catch { $('sysDb').innerHTML = '<span class="muted-pill">Unknown</span>'; }
    } catch (err) {
      if (String(err.message || '') !== 'Session expired') appError('Could not load dashboard — check the backend connection.');
    }
    loadRecentLogs(1);
  }
  function drawTrend(byDate) {
    const cv = $('trendChart'); if (!cv) return;
    const days = trendDays;
    const map = {};
    (byDate || []).forEach((d) => { map[d.date] = num(d.count); });
    const data = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      data.push({ label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), count: map[key] || 0 });
    }
    const total = data.reduce((s, x) => s + x.count, 0);
    show($('trendEmpty'), total === 0);
    const ctx = cv.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth || 600, hgt = 220;
    cv.width = w * dpr; cv.height = hgt * dpr; cv.style.height = hgt + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    const padL = 34, padR = 10, padT = 12, padB = 26;
    const maxV = Math.max(1, ...data.map((x) => x.count));
    const xAt = (i) => padL + (data.length === 1 ? (w - padL - padR) / 2 : i * (w - padL - padR) / (data.length - 1));
    const yAt = (v) => padT + (1 - v / maxV) * (hgt - padT - padB);
    ctx.font = '11px Archivo, sans-serif'; ctx.fillStyle = '#a9a7a2';
    ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1;
    const steps = Math.min(5, maxV);
    for (let s = 0; s <= steps; s++) {
      const v = Math.round(maxV * s / steps), y = yAt(v);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.fillText(String(v), 6, y + 4);
    }
    const step = data.length > 14 ? 5 : data.length > 7 ? 2 : 1;
    data.forEach((d, i) => { if (i % step === 0 || i === data.length - 1) ctx.fillText(d.label, xAt(i) - 14, hgt - 8); });
    const grad = ctx.createLinearGradient(0, padT, 0, hgt - padB);
    grad.addColorStop(0, 'rgba(232,17,45,.45)'); grad.addColorStop(1, 'rgba(232,17,45,0)');
    ctx.beginPath();
    data.forEach((d, i) => { i === 0 ? ctx.moveTo(xAt(i), yAt(d.count)) : ctx.lineTo(xAt(i), yAt(d.count)); });
    ctx.lineTo(xAt(data.length - 1), hgt - padB); ctx.lineTo(xAt(0), hgt - padB); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    ctx.beginPath();
    data.forEach((d, i) => { i === 0 ? ctx.moveTo(xAt(i), yAt(d.count)) : ctx.lineTo(xAt(i), yAt(d.count)); });
    ctx.strokeStyle = '#ff2e4d'; ctx.lineWidth = 2.5; ctx.lineJoin = 'round'; ctx.stroke();
    data.forEach((d, i) => {
      ctx.beginPath(); ctx.arc(xAt(i), yAt(d.count), 4, 0, Math.PI * 2);
      ctx.fillStyle = '#0d0d12'; ctx.fill(); ctx.strokeStyle = '#ff2e4d'; ctx.lineWidth = 2; ctx.stroke();
    });
  }
  function drawPlatform(byPlatform) {
    const cv = $('platformChart'); if (!cv) return;
    const entries = [
      { key: 'instagram', label: 'Instagram', color: '#ff2e63' },
      { key: 'youtube', label: 'YouTube', color: '#e8112d' },
      { key: 'facebook', label: 'Facebook', color: '#3b82f6' },
      { key: 'allinone', label: 'Video to Audio', color: '#a855f7' }
    ].map((e) => ({ label: e.label, color: e.color, count: num(byPlatform[e.key]) }))
      .filter((e) => e.count > 0);
    const total = entries.reduce((s, e) => s + e.count, 0);
    $('platformTotal').textContent = fmt(total);
    show($('platformEmpty'), total === 0);
    const ctx = cv.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    cv.width = 180 * dpr; cv.height = 180 * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, 180, 180);
    if (total === 0) {
      ctx.beginPath(); ctx.arc(90, 90, 70, 0, Math.PI * 2); ctx.strokeStyle = '#26262d'; ctx.lineWidth = 26; ctx.stroke();
      $('platformLegend').innerHTML = '';
      return;
    }
    let start = -Math.PI / 2;
    entries.forEach((e) => {
      const frac = e.count / total;
      ctx.beginPath(); ctx.arc(90, 90, 70, start, start + frac * Math.PI * 2);
      ctx.strokeStyle = e.color; ctx.lineWidth = 26; ctx.stroke();
      start += frac * Math.PI * 2;
    });
    $('platformLegend').innerHTML = entries.map((e) =>
      '<div class="legend-row"><span><span class="swatch" style="background:' + e.color + '"></span>' + esc(e.label) + '</span><b>' + Math.round(e.count / total * 100) + '% (' + fmt(e.count) + ')</b></div>'
    ).join('');
  }
  async function loadRecentLogs(page) {
    try {
      const r = await apiCall('logs', {
        page: page || 1, pageSize: 5,
        search: $('recentSearch').value.trim(),
        platform: $('recentPlatform').value,
        device: $('recentDevice').value
      }, true);
      if (!r || !r.ok) { appError((r && r.error) || 'Could not load logs.'); return; }
      recentState = { page: r.page || 1, pages: r.pages || 1, total: r.total || 0, rows: r.rows || [] };
      show($('recentLogsEmpty'), recentState.rows.length === 0);
      renderLogsTable($('recentLogsTable'), recentState.rows, { expandable: true, onToggle: () => loadRecentLogs(recentState.page) });
      renderPager($('recentPager'), recentState.page, recentState.pages, recentState.total, (p) => loadRecentLogs(p));
    } catch (err) {
      if (String(err.message || '') !== 'Session expired') appError('Could not load recent logs.');
    }
  }

  /* ---------- users ---------- */
  let allUsers = [];
  async function loadUsers() {
    try {
      const r = await apiCall('users', {}, true);
      if (!r || !r.ok) { appError((r && r.error) || 'Could not load users.'); return; }
      allUsers = r.users || [];
      renderUsers();
    } catch (err) {
      if (String(err.message || '') !== 'Session expired') appError('Could not load users.');
    }
  }
  function renderUsers() {
    const q = ($('userSearch').value || '').toLowerCase();
    const role = $('userRoleFilter').value;
    const status = $('userStatusFilter').value;
    const rows = allUsers.filter((u) => {
      if (q && !((u.name || '') + ' ' + (u.email || '')).toLowerCase().includes(q)) return false;
      if (role && u.role !== role) return false;
      if (status === 'blocked' && !u.blocked) return false;
      if (status === 'active' && !(u.active && !u.blocked)) return false;
      if (status === 'inactive' && u.active) return false;
      return true;
    });
    show($('usersEmpty'), rows.length === 0);
    const table = $('usersTable');
    const w = canWrite(), s = isSuper();
    table.innerHTML = '<thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Registered</th><th>Last login</th><th>Downloads</th><th>Device</th><th>Actions</th></tr></thead><tbody>' +
      rows.map((u) => {
        const statusBadge = u.blocked ? '<span class="badge red">Blocked</span>' : u.active ? '<span class="badge green">Active</span>' : '<span class="badge grey">Inactive</span>';
        const acts = [];
        if (w) {
          acts.push('<button class="btn ghost" data-act="edit" data-id="' + esc(u.id) + '">Edit</button>');
          acts.push('<button class="btn ghost" data-act="toggle-active" data-id="' + esc(u.id) + '">' + (u.active ? 'Deactivate' : 'Activate') + '</button>');
          acts.push('<button class="btn ghost" data-act="toggle-block" data-id="' + esc(u.id) + '">' + (u.blocked ? 'Unblock' : 'Block') + '</button>');
          acts.push('<button class="btn ghost" data-act="reset-pw" data-id="' + esc(u.id) + '">Reset password</button>');
        }
        if (s) acts.push('<button class="btn ghost" data-act="delete" data-id="' + esc(u.id) + '">Delete</button>');
        return '<tr><td data-label="Name">' + esc(u.name || '—') + '</td>' +
          '<td data-label="Email">' + esc(u.email || '—') + '</td>' +
          '<td data-label="Role">' + esc(u.role || 'user') + '</td>' +
          '<td data-label="Status">' + statusBadge + '</td>' +
          '<td data-label="Registered">' + esc(u.created || '—') + '</td>' +
          '<td data-label="Last login">' + esc(u.lastLogin || 'Never') + '</td>' +
          '<td data-label="Downloads">' + fmt(u.downloads) + '</td>' +
          '<td data-label="Device">' + esc(u.device || '—') + '</td>' +
          '<td data-label="Actions">' + (acts.length ? '<div class="row-actions">' + acts.join('') + '</div>' : '<span class="muted-pill">View only</span>') + '</td></tr>';
      }).join('') + '</tbody>';
    $$('button[data-act]', table).forEach((b) => b.addEventListener('click', () => userAction(b.dataset.act, b.dataset.id)));
  }
  async function userAction(act, id) {
    const u = allUsers.find((x) => String(x.id) === String(id));
    if (!u) return;
    if (u.role === 'super_admin' && !isSuper()) { appError('Only a super admin can change a super admin account.'); return; }
    try {
      if (act === 'edit') {
        // Only a super admin may change roles — and the role list must
        // include super_admin, or editing one would silently demote them.
        const roleField = isSuper()
          ? '<div class="field"><label for="mRole">Role</label><select id="mRole"><option value="user"' + (u.role === 'user' ? ' selected' : '') + '>User (read-only)</option><option value="admin"' + (u.role === 'admin' ? ' selected' : '') + '>Admin</option><option value="super_admin"' + (u.role === 'super_admin' ? ' selected' : '') + '>Super Admin</option></select></div>'
          : '';
        openModal('Edit user', '' +
          '<div class="field"><label for="mName">Name</label><input type="text" id="mName" value="' + esc(u.name || '') + '"></div>' +
          '<div class="field"><label for="mEmail">Email</label><input type="email" id="mEmail" value="' + esc(u.email || '') + '"></div>' +
          roleField,
          async () => {
            const roleEl = $('mRole');
            const r = await apiCall('updateUser', { id: u.id, name: $('mName').value.trim(), email: $('mEmail').value.trim(), role: roleEl ? roleEl.value : u.role, active: u.active, blocked: u.blocked }, true);
            if (!r || !r.ok) throw new Error((r && r.error) || 'Update failed.');
            loadUsers();
          });
        return;
      }
      if (act === 'reset-pw') {
        openModal('Reset password — ' + (u.email || ''), '' +
          '<div class="field"><label for="mPw">New password (min 8 characters)</label><input type="password" id="mPw" minlength="8" autocomplete="new-password"></div>' +
          '<p class="hint">The new password is set through the backend. It is never displayed afterwards.</p>',
          async () => {
            const pw = $('mPw').value;
            if (pw.length < 8) throw new Error('Password must be at least 8 characters.');
            const r = await apiCall('resetUserPassword', { id: u.id, password: pw }, true);
            if (!r || !r.ok) throw new Error((r && r.error) || 'Reset failed.');
          });
        return;
      }
      if (act === 'delete') {
        if (!confirm('Delete user ' + (u.email || u.name || '') + '? This cannot be undone.')) return;
        const r = await apiCall('deleteUser', { id: u.id }, true);
        if (!r || !r.ok) { appError((r && r.error) || 'Delete failed.'); return; }
        loadUsers(); return;
      }
      if (act === 'toggle-active') {
        const r = await apiCall('updateUser', { id: u.id, name: u.name, email: u.email, role: u.role, active: !u.active, blocked: u.blocked }, true);
        if (!r || !r.ok) { appError((r && r.error) || 'Update failed.'); return; }
        loadUsers(); return;
      }
      if (act === 'toggle-block') {
        const r = await apiCall('updateUser', { id: u.id, name: u.name, email: u.email, role: u.role, active: u.active, blocked: !u.blocked }, true);
        if (!r || !r.ok) { appError((r && r.error) || 'Update failed.'); return; }
        loadUsers();
      }
    } catch (err) {
      if (String(err.message || '') !== 'Session expired') appError(err.message || 'That action failed.');
    }
  }
  async function handleCreateUser(e) {
    e.preventDefault();
    showStatus($('userFormError'), ''); showStatus($('userFormOk'), '');
    const name = $('newUserName').value.trim();
    const email = $('newUserEmail').value.trim();
    const role = $('newUserRole').value;
    const password = $('newUserPassword').value;
    if (!name || !email) { showStatus($('userFormError'), 'Name and email are required.', 'err'); return; }
    if (password.length < 8) { showStatus($('userFormError'), 'Password must be at least 8 characters.', 'err'); return; }
    try {
      const r = await apiCall('createUser', { name, email, role, password }, true);
      if (!r || !r.ok) { showStatus($('userFormError'), (r && r.error) || 'Could not create the user.', 'err'); return; }
      showStatus($('userFormOk'), 'User created.', 'ok');
      $('createUserForm').reset();
      loadUsers();
    } catch (err) {
      if (String(err.message || '') !== 'Session expired') showStatus($('userFormError'), 'Could not reach the backend.', 'err');
    }
  }

  /* ---------- modal ---------- */
  let modalSaveFn = null;
  function openModal(title, bodyHtml, onSave) {
    $('modalTitle').textContent = title;
    $('modalBody').innerHTML = bodyHtml;
    $('modalSave').textContent = 'Save';
    showStatus($('modalError'), '');
    modalSaveFn = onSave;
    $('modalSave').style.display = onSave ? '' : 'none';
    $('modalBackdrop').style.display = 'flex';
  }
  function closeModal() { $('modalBackdrop').style.display = 'none'; modalSaveFn = null; }

  /* ---------- API management ---------- */
  const API_LABELS = { instagram: 'Instagram', youtube: 'YouTube', allinone: 'All-in-one' };
  const API_SAMPLES = {
    instagram: 'https://www.instagram.com/reels/DeEvB06NaqX/',
    youtube: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    allinone: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
  };
  function monthKey(d) { d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function quotaUsed(bucket) {
    const q = readJson(LS_QUOTA, {});
    return num(q[monthKey()] && q[monthKey()][bucket]);
  }
  function appLimits() {
    const local = readJson(LS_APP_SETTINGS, {});
    if (local.limits) return local.limits;
    const main = readJson(LS_MAIN_SETTINGS, {});
    return Object.assign({}, CFG.DEFAULT_LIMITS || {}, main.limits || {});
  }
  function rapidKey() {
    const main = readJson(LS_MAIN_SETTINGS, {});
    return main.rapidapiKey || CFG.DEFAULT_RAPIDAPI_KEY || '';
  }
  async function loadApi() {
    const hosts = CFG.API_HOSTS || {};
    const keys = Object.keys(hosts);
    const limits = appLimits();
    const disabled = (readJson(LS_APP_SETTINGS, {}).disabledHosts || []);
    const wrap = $('apiRows');
    if (!keys.length) { wrap.innerHTML = '<p class="empty">No API hosts are configured in config.js.</p>'; return; }
    wrap.innerHTML = keys.map((key) => {
      const host = hosts[key];
      const used = quotaUsed(key === 'facebook' ? 'allinone' : key);
      const limit = num(limits[key]);
      const left = Math.max(0, limit - used);
      const masked = rapidKey() ? '••••••••' + String(rapidKey()).slice(-4) : 'No key set';
      const isDisabled = disabled.includes(key);
      return '<div class="api-row" data-api="' + esc(key) + '">' +
        '<div class="api-head"><div><h3>' + esc(API_LABELS[key] || key) + '</h3><p class="host">' + esc(host) + '</p></div>' +
        '<span class="badge ' + (isDisabled ? 'red' : 'green') + '">' + (isDisabled ? 'Disabled' : 'Enabled') + '</span></div>' +
        '<p class="hint">Key: <b>' + esc(masked) + '</b> — the built-in key is public in the repo by the owner\'s choice; a key set in API keys below overrides it on this browser.</p>' +
        '<div class="api-meta"><span>Used this month: <b>' + fmt(used) + '</b></span><span>Limit: <b>' + fmt(limit) + '</b></span><span>Left: <b>' + fmt(left) + '</b></span><span>Connection: <b class="conn-status">Not tested</b></span></div>' +
        '<div class="field"><label>Monthly limit</label><input type="number" min="0" step="1" class="api-limit" data-api="' + esc(key) + '" value="' + limit + '"' + (canWrite() ? '' : ' disabled') + '></div>' +
        '<div class="api-actions">' +
        '<button class="btn ghost small" data-test="' + esc(key) + '"' + (canWrite() ? '' : ' disabled title="Your role is read-only."') + '>Test connection</button>' +
        '<span class="test-note">Test uses 1 API call.</span>' +
        '<button class="btn ghost small" data-toggle-api="' + esc(key) + '"' + (canWrite() ? '' : ' disabled title="Your role is read-only."') + '>' + (isDisabled ? 'Enable' : 'Disable') + '</button>' +
        '<button class="btn ghost small" data-save-limit="' + esc(key) + '"' + (canWrite() ? '' : ' disabled title="Your role is read-only."') + '>Save limit</button>' +
        '</div><p class="test-result" data-result="' + esc(key) + '"></p></div>';
    }).join('');
    // Restore last test results.
    const test = readJson(LS_API_TEST, null);
    if (test) {
      const row = wrap.querySelector('[data-result="' + test.host + '"]');
      if (row) row.textContent = test.ok ? 'Last test: HTTP ' + test.status + ' — OK (' + (test.at || '') + ')' : 'Last test: ' + (test.message || 'failed') + ' (' + (test.at || '') + ')';
      const conn = wrap.querySelector('[data-api="' + test.host + '"] .conn-status');
      if (conn) conn.textContent = test.ok ? 'Connected (last test)' : 'Failed (last test)';
    }
    $$('[data-test]', wrap).forEach((b) => b.addEventListener('click', () => testApi(b.dataset.test)));
    $$('[data-toggle-api]', wrap).forEach((b) => b.addEventListener('click', () => toggleApiHost(b.dataset.toggleApi)));
    $$('[data-save-limit]', wrap).forEach((b) => b.addEventListener('click', () => saveApiLimit(b.dataset.saveLimit)));
    loadKeyOverrides();
  }
  async function testApi(key) {
    const host = (CFG.API_HOSTS || {})[key];
    const resultEl = document.querySelector('[data-result="' + key + '"]');
    const connEl = document.querySelector('[data-api="' + key + '"] .conn-status');
    if (!host || !resultEl) return;
    const keyVal = rapidKey();
    if (!keyVal) { resultEl.textContent = 'No RapidAPI key available — add one in the main app Settings first.'; return; }
    resultEl.textContent = 'Testing… (uses 1 API call)';
    const sample = API_SAMPLES[key] || API_SAMPLES.allinone;
    try {
      let res;
      if (key === 'instagram') {
        res = await fetch('https://' + host + '/fetch?url=' + encodeURIComponent(sample), { headers: { 'x-rapidapi-host': host, 'x-rapidapi-key': keyVal } });
      } else if (key === 'allinone') {
        res = await fetch('https://' + host + '/extract', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-rapidapi-host': host, 'x-rapidapi-key': keyVal }, body: JSON.stringify({ url: sample }) });
      } else {
        res = await fetch('https://' + host + '/extract?url=' + encodeURIComponent(sample), { headers: { 'x-rapidapi-host': host, 'x-rapidapi-key': keyVal } });
      }
      const ok = res.ok;
      const record = { host: key, ok, status: res.status, at: new Date().toISOString(), message: ok ? '' : 'HTTP ' + res.status };
      localStorage.setItem(LS_API_TEST, JSON.stringify(record));
      resultEl.textContent = ok ? 'Test OK — HTTP ' + res.status + ' (1 API call used).' : 'Test failed — HTTP ' + res.status + '. Check the subscription on RapidAPI.';
      if (connEl) connEl.textContent = ok ? 'Connected (just tested)' : 'Failed (just tested)';
    } catch (err) {
      localStorage.setItem(LS_API_TEST, JSON.stringify({ host: key, ok: false, status: 0, at: new Date().toISOString(), message: String(err.message || err) }));
      resultEl.textContent = 'Test failed — could not reach the host: ' + err.message;
      if (connEl) connEl.textContent = 'Failed (just tested)';
    }
  }
  async function saveApiLimit(key) {
    const input = document.querySelector('.api-limit[data-api="' + key + '"]');
    if (!input) return;
    const limits = appLimits();
    limits[key] = Math.max(0, Number(input.value) || 0);
    await saveAppSettingsToBackend({ limits });
    showStatus($('apiMsg'), 'Limit for ' + (API_LABELS[key] || key) + ' saved (' + limits[key] + '/month).', 'ok');
    loadApi();
  }
  async function toggleApiHost(key) {
    const local = readJson(LS_APP_SETTINGS, {});
    const disabled = local.disabledHosts || [];
    const idx = disabled.indexOf(key);
    if (idx >= 0) disabled.splice(idx, 1); else disabled.push(key);
    await saveAppSettingsToBackend({ disabledHosts: disabled });
    showStatus($('apiMsg'), (API_LABELS[key] || key) + ' ' + (idx >= 0 ? 'enabled.' : 'disabled.'), 'ok');
    loadApi();
  }
  async function saveAppSettingsToBackend(patch) {
    const current = lastSettings || {};
    const local = readJson(LS_APP_SETTINGS, {});
    const merged = Object.assign({}, current, local, patch);
    const payload = {
      appName: merged.appName || 'Video Downloader',
      maintenance: !!merged.maintenance,
      limits: merged.limits || appLimits(),
      disabledHosts: merged.disabledHosts || [],
      lastBackup: merged.lastBackup || '',
      backups: merged.backups || []
    };
    // Local copy the main app can read.
    localStorage.setItem(LS_APP_SETTINGS, JSON.stringify({
      appName: payload.appName, maintenance: payload.maintenance,
      limits: payload.limits, disabledHosts: payload.disabledHosts, lastBackup: payload.lastBackup
    }));
    lastSettings = payload;
    try { await apiCall('settingsSet', { settings: payload }, true); } catch (err) {
      if (String(err.message || '') !== 'Session expired') appError('Saved locally, but the backend settings save failed.');
    }
    return payload;
  }

  /* ---------- accounts ---------- */
  const ACCOUNT_DEFAULTS = [
    { platform: 'Instagram', name: '', status: 'Not connected — downloads use RapidAPI, no account login', lastChecked: 'Never' },
    { platform: 'YouTube', name: '', status: 'Not connected — downloads use RapidAPI, no account login', lastChecked: 'Never' },
    { platform: 'Facebook', name: '', status: 'Not connected — downloads use RapidAPI, no account login', lastChecked: 'Never' }
  ];
  let accounts = [];
  async function loadAccounts() {
    try {
      const r = await apiCall('accountsGet', {}, true);
      accounts = (r && r.ok && Array.isArray(r.accounts)) ? r.accounts : [];
    } catch (err) {
      if (String(err.message || '') !== 'Session expired') appError('Could not load accounts.');
      accounts = [];
    }
    renderAccounts();
  }
  function renderAccounts() {
    const wrap = $('accountsRows');
    const shown = accounts.length ? accounts : ACCOUNT_DEFAULTS;
    show($('accountsEmpty'), accounts.length === 0 && false); // defaults are shown instead; empty state is for removed rows
    // If the backend stored an empty list explicitly, show the removed state.
    if (accounts.length === 0 && loadAccounts._explicitEmpty) {
      wrap.innerHTML = '';
      show($('accountsEmpty'), true);
      return;
    }
    show($('accountsEmpty'), false);
    wrap.innerHTML = shown.map((a, i) => {
      const idx = accounts.length ? i : -1;
      const platform = a.platform || ACCOUNT_DEFAULTS[i].platform;
      return '<div class="account-row"><div><h3>' + esc(platform) + '</h3>' +
        '<p>Status: ' + esc(a.status || 'Not connected — downloads use RapidAPI, no account login') + '</p>' +
        '<p>Account: ' + esc(a.name || '—') + ' · Last checked: ' + esc(a.lastChecked || 'Never') + '</p></div>' +
        '<div class="row-actions">' +
        '<button class="btn ghost" data-acc="check" data-i="' + i + '"' + (canWrite() ? '' : ' disabled title="Your role is read-only."') + '>Check now</button>' +
        '<button class="btn ghost" data-acc="toggle" data-i="' + i + '"' + (canWrite() ? '' : ' disabled title="Your role is read-only."') + '>' + (/Disabled/i.test(a.status || '') ? 'Enable' : 'Disable') + '</button>' +
        '<button class="btn ghost" data-acc="remove" data-i="' + i + '"' + (canWrite() ? '' : ' disabled title="Your role is read-only."') + '>Remove</button>' +
        '</div></div>';
    }).join('');
    $$('[data-acc]', wrap).forEach((b) => b.addEventListener('click', () => accountAction(b.dataset.acc, Number(b.dataset.i))));
  }
  async function accountAction(act, i) {
    if (!canWrite()) { appError('Your role is read-only.'); return; }
    // Start from stored accounts, or from defaults when nothing is stored yet.
    let list = accounts.length ? accounts.slice() : ACCOUNT_DEFAULTS.map((a) => Object.assign({}, a));
    if (act === 'remove') {
      list.splice(i, 1);
      loadAccounts._explicitEmpty = list.length === 0;
    } else if (act === 'check') {
      list[i] = Object.assign({}, list[i], { lastChecked: new Date().toISOString() });
    } else if (act === 'toggle') {
      const cur = list[i].status || '';
      list[i] = Object.assign({}, list[i], { status: /Disabled/i.test(cur) ? 'Not connected — downloads use RapidAPI, no account login' : 'Disabled' });
    }
    accounts = list;
    try {
      const r = await apiCall('accountsSet', { accounts: list }, true);
      if (!r || !r.ok) { appError((r && r.error) || 'Could not save accounts.'); return; }
      showStatus($('accountsMsg'), 'Accounts saved.', 'ok');
    } catch (err) {
      if (String(err.message || '') !== 'Session expired') appError('Could not save accounts.');
    }
    renderAccounts();
  }

  /* ---------- usage & reports ---------- */
  async function loadUsage() {
    try {
      const s = await apiCall('stats', {}, true);
      if (!s || !s.ok) { appError((s && s.error) || 'Could not load stats.'); return; }
      lastStats = s;
      const byDate = s.byDate || [];
      const todayKey = new Date().toISOString().slice(0, 10);
      const today = byDate.find((d) => d.date === todayKey);
      const week = byDate.slice(-7).reduce((a, d) => a + num(d.count), 0);
      const month = byDate.slice(-30).reduce((a, d) => a + num(d.count), 0);
      $('usageToday').textContent = fmt(s.downloads ? s.downloads.today : num(today && today.count));
      $('usageWeek').textContent = fmt(week);
      $('usageMonth').textContent = fmt(month);
      $('usageTotal').textContent = fmt(s.downloads ? s.downloads.total : 0);
      $('usageFailed').textContent = '0';
      const byPlatform = s.byPlatform || {};
      const total = Object.values(byPlatform).reduce((a, n) => a + num(n), 0);
      $('usagePlatform').innerHTML = total === 0
        ? '<p class="empty">No downloads yet.</p>'
        : Object.entries(byPlatform).map(([k, v]) => '<div class="kv-row"><span>' + esc(API_LABELS[k] || k) + '</span><b>' + fmt(v) + (total ? ' (' + Math.round(num(v) / total * 100) + '%)' : '') + '</b></div>').join('');
      // Tool-wise + most-used tools from the first 100 log rows.
      let toolCounts = {};
      try {
        const from = $('usageFrom').value, to = $('usageTo').value;
        const logs = await apiCall('logs', { page: 1, pageSize: 100, dateFrom: from || '', dateTo: to || '' }, true);
        (logs && logs.rows || []).forEach((r) => { toolCounts[r.tool || 'unknown'] = (toolCounts[r.tool || 'unknown'] || 0) + 1; });
      } catch { toolCounts = {}; }
      const toolEntries = Object.entries(toolCounts).sort((a, b) => b[1] - a[1]);
      $('usageTools').innerHTML = toolEntries.length ? toolEntries.map(([k, v]) => '<div class="kv-row"><span>' + esc(k) + '</span><b>' + fmt(v) + '</b></div>').join('') : '<p class="empty">No downloads in this range yet.</p>';
      $('usageTopTools').innerHTML = toolEntries.length ? toolEntries.slice(0, 5).map(([k, v], i) => '<div class="kv-row"><span>#' + (i + 1) + ' ' + esc(k) + '</span><b>' + fmt(v) + '</b></div>').join('') : '<p class="empty">No downloads yet.</p>';
      const limits = appLimits();
      const buckets = ['instagram', 'youtube', 'allinone'];
      $('usageQuota').innerHTML = buckets.map((b) => {
        const used = quotaUsed(b);
        const limit = num(limits[b]);
        return '<div class="kv-row"><span>' + esc(API_LABELS[b] || b) + ' — used / limit</span><b>' + fmt(used) + ' / ' + fmt(limit) + '</b></div>' +
          '<div class="kv-row"><span>' + esc(API_LABELS[b] || b) + ' — remaining</span><b>' + fmt(Math.max(0, limit - used)) + '</b></div>';
      }).join('') + '<div class="kv-row"><span>Facebook (via All-in-one)</span><b>' + fmt(quotaUsed('allinone')) + ' used</b></div>';
    } catch (err) {
      if (String(err.message || '') !== 'Session expired') appError('Could not load usage.');
    }
  }

  /* ---------- download logs (full page) ---------- */
  let logsState = { page: 1, pages: 1, total: 0, rows: [] };
  async function loadLogs(page) {
    try {
      const r = await apiCall('logs', {
        page: page || 1, pageSize: 10,
        search: $('logsSearch').value.trim(),
        platform: $('logsPlatform').value,
        device: $('logsDevice').value,
        tool: $('logsTool').value,
        dateFrom: $('logsFrom').value || '',
        dateTo: $('logsTo').value || ''
      }, true);
      if (!r || !r.ok) { appError((r && r.error) || 'Could not load logs.'); return; }
      logsState = { page: r.page || 1, pages: r.pages || 1, total: r.total || 0, rows: r.rows || [] };
      show($('logsEmpty'), logsState.rows.length === 0);
      renderLogsTable($('logsTable'), logsState.rows, { expandable: true, onToggle: () => loadLogs(logsState.page) });
      renderPager($('logsPager'), logsState.page, logsState.pages, logsState.total, (p) => loadLogs(p));
    } catch (err) {
      if (String(err.message || '') !== 'Session expired') appError('Could not load logs.');
    }
  }

  /* ---------- database ---------- */
  async function loadDatabase() {
    try {
      const t = await apiCall('tabs', {}, true);
      if (!t || !t.ok) { appError((t && t.error) || 'Could not load tabs.'); return; }
      lastTabs = t.tabs || [];
      $('dbHealth').textContent = 'Database health: Healthy — ' + lastTabs.length + ' tab(s), ' + fmt(lastTabs.reduce((s, x) => s + num(x.rows), 0)) + ' rows total (Google Sheets).';
      renderDbTabs();
      renderBackupHistory();
    } catch (err) {
      if (String(err.message || '') !== 'Session expired') appError('Could not load database.');
    }
  }
  function renderDbTabs() {
    const wrap = $('dbTabs');
    if (!lastTabs.length) { wrap.innerHTML = '<p class="empty">No tabs found.</p>'; return; }
    wrap.innerHTML = lastTabs.map((x) => '<button type="button" class="db-tab' + (selectedDbTab === x.name ? ' active' : '') + '" data-tab="' + esc(x.name) + '"><b>' + esc(x.name) + '</b><span>' + fmt(x.rows) + ' rows</span></button>').join('');
    $$('[data-tab]', wrap).forEach((b) => b.addEventListener('click', () => viewDbTab(b.dataset.tab)));
  }
  async function viewDbTab(name) {
    selectedDbTab = name;
    $('dbViewerTitle').textContent = name;
    $('dbExportBtn').disabled = false;
    renderDbTabs();
    try {
      const r = await apiCall('exportTab', { tab: name }, true);
      if (!r || !r.ok) { appError((r && r.error) || 'Could not export that tab.'); return; }
      selectedDbCsv = r.csv || '';
      renderDbViewer();
    } catch (err) {
      if (String(err.message || '') !== 'Session expired') appError('Could not export that tab.');
    }
  }
  function renderDbViewer() {
    const rows = parseCsv(selectedDbCsv);
    const q = ($('dbSearch').value || '').toLowerCase();
    const filtered = q ? rows.filter((r, i) => i === 0 || r.join(' ').toLowerCase().includes(q)) : rows;
    const shown = filtered.slice(0, 101); // header + first 100 rows
    const table = $('dbViewerTable');
    show($('dbViewerEmpty'), shown.length === 0);
    if (!shown.length) { table.innerHTML = ''; return; }
    table.innerHTML = '<thead><tr>' + shown[0].map((c) => '<th>' + esc(c) + '</th>').join('') + '</tr></thead><tbody>' +
      shown.slice(1).map((r) => '<tr>' + r.map((c) => '<td>' + esc(c) + '</td>').join('') + '</tr>').join('') + '</tbody>';
    if (filtered.length > 101) $('dbViewerEmpty').style.display = 'block', $('dbViewerEmpty').textContent = 'Showing the first 100 rows of ' + fmt(filtered.length - 1) + ' — use search or Export CSV for the rest.';
  }
  function renderBackupHistory() {
    const backups = (lastSettings && lastSettings.backups) || [];
    $('backupHistory').innerHTML = backups.length
      ? backups.map((b) => '<div class="kv-row"><span>' + esc(b.at || '') + '</span><b>' + fmt(b.rows) + ' rows</b></div>').join('')
      : '<p class="empty">No backups yet.</p>';
  }
  async function handleBackup() {
    if (!canWrite()) { appError('Your role is read-only.'); return; }
    try {
      const r = await apiCall('backup', {}, true);
      if (!r || !r.ok) { appError((r && r.error) || 'Backup failed.'); return; }
      const at = (r.backup && r.exportedAt) || new Date().toISOString();
      const totalRows = lastTabs.reduce((s, x) => s + num(x.rows), 0);
      downloadFile('video-downloader-backup-' + at.slice(0, 10) + '.json', JSON.stringify(r.backup || r, null, 2), 'application/json');
      const backups = ((lastSettings && lastSettings.backups) || []).slice();
      backups.unshift({ at, rows: totalRows });
      await saveAppSettingsToBackend({ backups: backups.slice(0, 20), lastBackup: at });
      $('sysLastBackup') && ($('sysLastBackup').textContent = at);
      renderBackupHistory();
      showStatus($('appError'), '');
    } catch (err) {
      if (String(err.message || '') !== 'Session expired') appError('Backup failed — check the backend connection.');
    }
  }

  /* ---------- app settings ---------- */
  /* ---------- restore (super_admin only; backend validates first) ---------- */
  async function handleRestoreFile(file) {
    if (!isSuper()) { appError('Only a super admin can restore a backup.'); return; }
    let snap;
    try { snap = JSON.parse(await file.text()); }
    catch { appError('That file is not a valid backup (it is not JSON).'); return; }
    if (!snap || typeof snap !== 'object' || Array.isArray(snap)) { appError('That file is not a valid backup.'); return; }
    const tabs = Object.keys(snap).filter((t) => typeof snap[t] === 'string');
    if (!tabs.length) { appError('That backup file has no tab data in it.'); return; }
    const rows = tabs.map((t) => ({ tab: t, n: Math.max(0, String(snap[t]).split('\n').length - 1) }));
    openModal('Restore backup',
      '<p><b>This replaces the current data</b> in ' + tabs.length + ' tab(s) with the backup. The current data in those tabs is overwritten — download a fresh backup first if you want to keep it.</p>' +
      '<div>' + rows.map((r) => '<div class="kv-row"><span>' + esc(r.tab) + '</span><b>' + fmt(r.n) + ' rows</b></div>').join('') + '</div>' +
      '<p class="hint">Live admin sessions are not affected. The backend checks every tab before writing anything — a bad file changes nothing.</p>',
      async () => {
        const r = await apiCall('restore', { backup: snap, confirm: true }, true);
        if (!r || !r.ok) {
          if (/Unknown action/.test((r && r.error) || '')) throw new Error('Your backend script is out of date — paste the new Code.gs into Apps Script and redeploy the web app, then try again.');
          throw new Error((r && r.error) || 'Restore failed.');
        }
        showStatus($('appError'), 'Backup restored: ' + Object.keys(r.restored || {}).map((t) => t + ' (' + r.restored[t] + ' rows)').join(', ') + '.', 'ok');
        loadDatabase(); loadDashboard();
      });
    $('modalSave').textContent = 'Restore backup';
  }

  /* ---------- API key overrides (this browser only) ----------
     The public app reads its keys from vd_settings when present, else
     the built-in keys in config.js. An override set here affects only
     this browser — the same limit as admin-set limits. */
  function loadKeyOverrides() {
    const main = readJson(LS_MAIN_SETTINGS, {});
    const show = (id, val) => { const e = $(id); if (e) e.textContent = val ? '••••••••' + String(val).slice(-4) : 'Using the built-in key'; };
    show('rapidKeyState', main.rapidapiKey);
    show('scrappaKeyState', main.scrappaKey);
  }
  function saveKeyOverrides() {
    if (!canWrite()) { showStatus($('keyMsg'), 'Your role is read-only.', 'err'); return; }
    const main = readJson(LS_MAIN_SETTINGS, {});
    const rk = $('overrideRapidKey').value.trim();
    const sk = $('overrideScrappaKey').value.trim();
    if (rk) main.rapidapiKey = rk;
    if (sk) main.scrappaKey = sk;
    localStorage.setItem(LS_MAIN_SETTINGS, JSON.stringify(main));
    $('overrideRapidKey').value = ''; $('overrideScrappaKey').value = '';
    loadKeyOverrides();
    showStatus($('keyMsg'), 'Keys saved for this browser. The public app will use them from now on.', 'ok');
  }
  function clearKeyOverrides() {
    if (!canWrite()) { showStatus($('keyMsg'), 'Your role is read-only.', 'err'); return; }
    const main = readJson(LS_MAIN_SETTINGS, {});
    delete main.rapidapiKey; delete main.scrappaKey;
    localStorage.setItem(LS_MAIN_SETTINGS, JSON.stringify(main));
    loadKeyOverrides();
    showStatus($('keyMsg'), 'Overrides cleared — the built-in keys are used again.', 'ok');
  }

  async function loadAppSettings() {
    try {
      const g = await apiCall('settingsGet', {}, true);
      if (g && g.ok) lastSettings = g.settings || {};
    } catch { /* keep local copy */ }
    const s = lastSettings || {};
    const local = readJson(LS_APP_SETTINGS, {});
    const limits = s.limits || local.limits || appLimits();
    $('setAppName').value = s.appName || local.appName || 'Video Downloader';
    $('setLimitIg').value = num(limits.instagram);
    $('setLimitYt').value = num(limits.youtube);
    $('setLimitFb').value = num(limits.facebook);
    $('setLimitAll').value = num(limits.allinone);
    $('setMaintenance').checked = !!(s.maintenance != null ? s.maintenance : local.maintenance);
    $('setLastBackup').textContent = (s.lastBackup || local.lastBackup) || 'Never';
  }
  async function handleSaveAppSettings(e) {
    e.preventDefault();
    if (!canWrite()) { showStatus($('settingsError'), 'Your role is read-only.', 'err'); return; }
    showStatus($('settingsError'), ''); showStatus($('settingsOk'), '');
    const payload = {
      appName: $('setAppName').value.trim() || 'Video Downloader',
      maintenance: $('setMaintenance').checked,
      limits: {
        instagram: Math.max(0, Number($('setLimitIg').value) || 0),
        youtube: Math.max(0, Number($('setLimitYt').value) || 0),
        facebook: Math.max(0, Number($('setLimitFb').value) || 0),
        allinone: Math.max(0, Number($('setLimitAll').value) || 0)
      },
      disabledHosts: (readJson(LS_APP_SETTINGS, {}).disabledHosts || []),
      lastBackup: (lastSettings && lastSettings.lastBackup) || (readJson(LS_APP_SETTINGS, {}).lastBackup) || ''
    };
    // Local copy the main app can read.
    localStorage.setItem(LS_APP_SETTINGS, JSON.stringify(payload));
    try {
      const r = await apiCall('settingsSet', { settings: payload }, true);
      if (!r || !r.ok) { showStatus($('settingsError'), (r && r.error) || 'Could not save settings.', 'err'); return; }
      lastSettings = Object.assign({}, lastSettings, payload);
      $('setLastBackup').textContent = payload.lastBackup || 'Never';
      showStatus($('settingsOk'), 'Settings saved (backend + this browser).', 'ok');
    } catch (err) {
      if (String(err.message || '') !== 'Session expired') showStatus($('settingsError'), 'Saved in this browser, but the backend save failed.', 'err');
    }
  }

  /* ---------- audit logs ---------- */
  async function loadAudit(page) {
    try {
      const r = await apiCall('audit', { page: page || 1, pageSize: 10 }, true);
      if (!r || !r.ok) { appError((r && r.error) || 'Could not load audit logs.'); return; }
      const rows = r.rows || [];
      show($('auditEmpty'), rows.length === 0);
      $('auditTable').innerHTML = '<thead><tr><th>Date</th><th>Time</th><th>Admin</th><th>Action</th><th>Result</th><th>Details</th></tr></thead><tbody>' +
        rows.map((x) => '<tr><td>' + esc(x.date || '') + '</td><td>' + esc(x.time || '') + '</td><td>' + esc(x.admin || '') + '</td><td>' + esc(x.action || '') + '</td><td>' + esc(x.result || '') + '</td><td>' + esc(x.details || '') + '</td></tr>').join('') + '</tbody>';
      renderPager($('auditPager'), r.page || 1, r.pages || 1, r.total || 0, (p) => loadAudit(p));
    } catch (err) {
      if (String(err.message || '') !== 'Session expired') appError('Could not load audit logs.');
    }
  }

  /* ---------- usage report CSV ---------- */
  function exportUsageCsv() {
    const s = lastStats || {};
    const lines = [['Metric', 'Value']];
    lines.push(['Total downloads', num(s.downloads && s.downloads.total)]);
    lines.push(['Today\'s downloads', num(s.downloads && s.downloads.today)]);
    lines.push(['Total users', num(s.users && s.users.total)]);
    lines.push(['Active users', num(s.users && s.users.active)]);
    lines.push(['Blocked users', num(s.users && s.users.blocked)]);
    lines.push(['API accounts', num(s.apiAccounts)]);
    Object.entries(s.byPlatform || {}).forEach(([k, v]) => lines.push(['Downloads — ' + k, num(v)]));
    (s.byDate || []).forEach((d) => lines.push(['Downloads — ' + d.date, num(d.count)]));
    lines.push(['Failed downloads', 0]);
    lines.push(['Note', 'Failed fetches are not stored in v1']);
    downloadFile('usage-report.csv', lines.map((r) => r.map(csvCell).join(',')).join('\n'), 'text/csv');
  }

  /* ---------- wire up ---------- */
  document.addEventListener('click', resetInactivity, true);
  document.addEventListener('keydown', resetInactivity, true);
  window.addEventListener('resize', () => { if (currentSection === 'dashboard' && lastStats) drawTrend(lastStats.byDate || []); });

  $('loginForm').addEventListener('submit', handleLogin);
  $('setupForm').addEventListener('submit', handleSetup);
  $('changeForm').addEventListener('submit', handleChangePassword);
  $('changeLogoutBtn').addEventListener('click', logout);
  $('saveBackendBtn').addEventListener('click', async () => {
    const url = $('backendUrlInput').value.trim();
    if (!url) { $('backendStatus').textContent = 'Paste the Apps Script web-app URL first.'; return; }
    setBackendUrl(url);
    $('backendStatus').textContent = 'Checking backend…';
    try {
      const p = await pingBackend();
      backendOk = !!(p && p.ok);
      if (backendOk) {
        $('backendStatus').textContent = 'Backend connected. You can log in now.';
        if (p.setupDone === false) { $('setupBackendLine').textContent = 'Backend: ' + backendUrl; showView('setup'); }
      } else $('backendStatus').textContent = 'Backend did not answer OK — check the deployment (Execute as Me, Anyone).';
    } catch { backendOk = false; $('backendStatus').textContent = 'Could not reach that URL — check it and the deployment.'; }
    updateBackendNotice();
  });
  $$('.pw-toggle').forEach((b) => b.addEventListener('click', () => {
    const input = $(b.dataset.toggle);
    if (!input) return;
    const showPw = input.type === 'password';
    input.type = showPw ? 'text' : 'password';
    b.textContent = showPw ? 'Hide' : 'Show';
  }));

  $$('#adminNav .nav-item[data-section]').forEach((b) => b.addEventListener('click', () => showSection(b.dataset.section)));
  $$('[data-goto]').forEach((b) => b.addEventListener('click', () => showSection(b.dataset.goto)));
  $('navLogoutBtn').addEventListener('click', logout);
  $('topLogoutBtn').addEventListener('click', logout);
  $('navProfileBtn').addEventListener('click', () => {
    openModal('Admin Profile', '' +
      '<p style="line-height:1.7;"><b>Email:</b> ' + esc(adminEmail || '—') + '<br><b>Role:</b> ' + esc(adminRole || '—') + '<br><b>Session:</b> expires after 30 minutes without activity.</p>' +
      '<p class="hint">To change your password, log out and use the change-password flow, or ask another admin to reset it.</p>', null);
    $('modalSave').style.display = 'none';
  });
  $('hamburger').addEventListener('click', () => { $('adminSidebar').classList.add('open'); $('backdrop').classList.add('show'); });
  $('drawerClose').addEventListener('click', () => { $('adminSidebar').classList.remove('open'); $('backdrop').classList.remove('show'); });
  $('backdrop').addEventListener('click', () => { $('adminSidebar').classList.remove('open'); $('backdrop').classList.remove('show'); });

  $('trendRange').addEventListener('change', () => { trendDays = Number($('trendRange').value) || 7; if (lastStats) drawTrend(lastStats.byDate || []); });
  $('viewAllLogsBtn').addEventListener('click', () => showSection('logs'));
  $('recentSearch').addEventListener('input', () => loadRecentLogs(1));
  $('recentPlatform').addEventListener('change', () => loadRecentLogs(1));
  $('recentDevice').addEventListener('change', () => loadRecentLogs(1));
  $('recentExportBtn').addEventListener('click', () => downloadFile('recent-download-logs.csv', logsToCsv(recentState.rows), 'text/csv'));

  $('userSearch').addEventListener('input', renderUsers);
  $('userRoleFilter').addEventListener('change', renderUsers);
  $('userStatusFilter').addEventListener('change', renderUsers);
  $('createUserForm').addEventListener('submit', handleCreateUser);

  $('restoreAccountsBtn').addEventListener('click', async () => {
    accounts = ACCOUNT_DEFAULTS.map((a) => Object.assign({}, a));
    loadAccounts._explicitEmpty = false;
    try { await apiCall('accountsSet', { accounts }, true); } catch { /* show defaults anyway */ }
    renderAccounts();
  });

  $('usageApplyBtn').addEventListener('click', loadUsage);
  $('usageExportBtn').addEventListener('click', exportUsageCsv);

  ['logsSearch', 'logsPlatform', 'logsDevice', 'logsTool', 'logsFrom', 'logsTo'].forEach((id) => {
    $(id).addEventListener('change', () => loadLogs(1));
    if (id === 'logsSearch') $(id).addEventListener('input', () => loadLogs(1));
  });
  $('logsExportBtn').addEventListener('click', () => downloadFile('download-logs.csv', logsToCsv(logsState.rows), 'text/csv'));

  $('dbSearch').addEventListener('input', renderDbViewer);
  $('dbExportBtn').addEventListener('click', () => {
    if (!selectedDbTab || !selectedDbCsv) return;
    downloadFile(selectedDbTab + '.csv', selectedDbCsv, 'text/csv');
  });
  $('dbBackupBtn').addEventListener('click', handleBackup);
  $('dbRestoreBtn').addEventListener('click', () => $('dbRestoreFile').click());
  $('dbRestoreFile').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    e.target.value = '';
    if (f) handleRestoreFile(f);
  });

  $('keySaveBtn').addEventListener('click', saveKeyOverrides);
  $('keyClearBtn').addEventListener('click', clearKeyOverrides);

  $('appSettingsForm').addEventListener('submit', handleSaveAppSettings);

  $('modalCancel').addEventListener('click', closeModal);
  $('modalBackdrop').addEventListener('click', (e) => { if (e.target === $('modalBackdrop')) closeModal(); });
  $('modalSave').addEventListener('click', async () => {
    if (!modalSaveFn) { closeModal(); return; }
    const btn = $('modalSave'); btn.disabled = true;
    try { await modalSaveFn(); closeModal(); }
    catch (err) { showStatus($('modalError'), err.message || 'Save failed.', 'err'); }
    finally { btn.disabled = false; }
  });

  init();
})();
