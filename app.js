/* ==========================================================================
   Video Downloader — app.js
   Flow: paste URL -> Fetch (1 API call) -> preview on screen ->
         pick quality -> Download straight to PC / phone.
   A built-in RapidAPI key (config.js, owner's choice, public repo) is
   used when no key is saved in this browser; a saved key overrides it.
   The key, Apps Script URL and limits live ONLY in localStorage
   (vd_settings) — there is no Settings section in the user app;
   the owner sets them from the admin panel or by saving them
   in the browser's localStorage.
   except: the RapidAPI host you fetch from, and your own Apps Script URL.
   ========================================================================== */
(function () {
  'use strict';
  const CFG = window.VD_CONFIG;
  const { API_HOSTS, DEFAULT_LIMITS, STORE, TOOLS, DEFAULT_RAPIDAPI_KEY } = CFG;

  /* ---------- tiny helpers ---------- */
  const $ = (id) => document.getElementById(id);
  const el = {
    sidebar: $('sidebar'), backdrop: $('backdrop'), hamburger: $('hamburger'),
    pageTitle: $('pageTitle'), pageSub: $('pageSub'), monthLabel: $('monthLabel'),
    fetchTitle: $('fetchTitle'), fetchHint: $('fetchHint'),
    urlInput: $('urlInput'), fetchBtn: $('fetchBtn'), status: $('status'),
    usernameRow: $('usernameRow'), usernameInput: $('usernameInput'), usernameBtn: $('usernameBtn'),
    previewCard: $('previewCard'), previewVideo: $('previewVideo'), previewImage: $('previewImage'),
    previewDuration: $('previewDuration'), previewTitle: $('previewTitle'),
    previewAuthor: $('previewAuthor'), previewCaption: $('previewCaption'),
    qualityList: $('qualityList'), downloadBtn: $('downloadBtn'),
    copyCaptionBtn: $('copyCaptionBtn'), copyLinkBtn: $('copyLinkBtn'),
    progress: $('progress'), progressBar: $('progressBar'), progressText: $('progressText'),
    downloadNote: $('downloadNote'), quotaGrid: $('quotaGrid'),
    historyList: $('historyList'), apiKeyInput: $('apiKeyInput'),
    statTotal: $('statTotal'), statUrls: $('statUrls'), statMonth: $('statMonth'), statApi: $('statApi'),
    statRow: $('statRow'), trendCard: $('trendCard'), trendChart: $('trendChart'),
    trendEmpty: $('trendEmpty'), trendThisMonth: $('trendThisMonth'), trendChange: $('trendChange'),
    trendRange: $('trendRange'), tabsBar: $('tabsBar'), converterCard: $('converterCard'),
    audioFileInput: $('audioFileInput'), audioFileName: $('audioFileName'),
    audioFormat: $('audioFormat'), audioQuality: $('audioQuality'), convertBtn: $('convertBtn'),
    viewAllBtn: $('viewAllBtn'), drawerClose: $('drawerClose'),
    appsScriptInput: $('appsScriptInput'), settingsMsg: $('settingsMsg'),
    quickActions: $('quickActions'), qualitySelect: $('qualitySelect'), qualityRow: $('qualityRow'),
    convertProgress: $('convertProgress'), convertBar: $('convertBar'), convertText: $('convertText')
  };

  let currentTool = 'dashboard';
  let currentResult = null;   // normalised fetch result
  let selectedQuality = null; // chosen format object
  let lastSortedFormats = []; // formats of the current preview, in pill order
  let showAllHistory = false;
  let trendDays = 7;
  let audioFormatChoice = 'mp3';
  let audioQualityChoice = '192';

  /* ---------- admin-managed app settings (set by admin.html) ----------
     The admin panel saves to localStorage 'vd_app_settings' AND to the
     Sheet (dl_settings). This app reads the local copy: maintenance mode,
     disabled APIs, admin-set limits and app name. The public app has NO
     login wall in v1 — these settings cannot block anonymous downloads
     beyond disabling a host / showing a maintenance notice. */
  function loadAppSettings() {
    try { return JSON.parse(localStorage.getItem('vd_app_settings') || '{}'); } catch { return {}; }
  }
  let appSettings = loadAppSettings();
  function isHostDisabled(bucket) {
    const d = appSettings.disabledHosts || [];
    return d.indexOf(bucket) !== -1;
  }
  function applyAppSettings() {
    if (appSettings.appName) document.title = appSettings.appName + ' — Video Downloader';
    if (appSettings.maintenance) {
      const main = document.querySelector('.main');
      if (main && !document.getElementById('maintBanner')) {
        const b = document.createElement('div');
        b.id = 'maintBanner'; b.className = 'status show err';
        b.style.marginBottom = '18px';
        b.textContent = 'Maintenance mode is on — downloads are paused. Please check back soon.';
        main.insertBefore(b, main.firstChild);
      }
      if (el.fetchBtn) el.fetchBtn.disabled = true;
    }
  }

  /* ---------- settings (localStorage only) ---------- */
  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE.settings) || '{}');
      return {
        rapidapiKey: s.rapidapiKey || DEFAULT_RAPIDAPI_KEY || '',
        appsScriptUrl: s.appsScriptUrl || '',
        limits: Object.assign({}, DEFAULT_LIMITS, appSettings.limits || {}, s.limits || {})
      };
    } catch { return { rapidapiKey: DEFAULT_RAPIDAPI_KEY || '', appsScriptUrl: '', limits: Object.assign({}, DEFAULT_LIMITS, appSettings.limits || {}) }; }
  }
  function saveSettings(s) { localStorage.setItem(STORE.settings, JSON.stringify(s)); }
  let settings = loadSettings();

  function monthKey(d) { d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); }
  function nextResetDate() {
    const n = new Date(); n.setDate(1); n.setMonth(n.getMonth() + 1);
    return n.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
  }

  /* ---------- quota: 1 fetch = 1 use, keyed YYYY-MM per API ---------- */
  function loadQuota() {
    try { return JSON.parse(localStorage.getItem(STORE.quota) || '{}'); } catch { return {}; }
  }
  function getUsed(bucket) {
    const q = loadQuota();
    return (q[monthKey()] && q[monthKey()][bucket]) || 0;
  }
  function bumpQuota(bucket) {
    const q = loadQuota(); const m = monthKey();
    q[m] = q[m] || {};
    q[m][bucket] = (q[m][bucket] || 0) + 1;
    localStorage.setItem(STORE.quota, JSON.stringify(q));
    renderQuota();
  }
  function quotaLeft(bucket) { return Math.max(0, (settings.limits[bucket] || 0) - getUsed(bucket)); }

  function renderQuota() {
    const rows = [
      { bucket: 'instagram', label: 'Instagram', host: API_HOSTS.instagram },
      { bucket: 'youtube',   label: 'YouTube',   host: API_HOSTS.youtube },
      { bucket: 'facebook',  label: 'Facebook',  host: 'via All-in-one API' },
      { bucket: 'allinone',  label: 'All-in-one', host: API_HOSTS.allinone }
    ];
    el.monthLabel.textContent = new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    el.quotaGrid.innerHTML = rows.map(r => {
      const used = getUsed(r.bucket), limit = settings.limits[r.bucket] || 0;
      const left = Math.max(0, limit - used);
      const pct = limit ? Math.min(100, Math.round(used / limit * 100)) : 0;
      const cls = left === 0 ? 'out' : left <= Math.max(5, limit * 0.1) ? 'low' : '';
      return '<div class="quota ' + cls + '">' +
        '<div class="q-head"><b>' + r.label + '</b><span>' + used + ' / ' + limit + ' used</span></div>' +
        '<div class="q-num">' + left + ' <small>left</small></div>' +
        '<div class="q-bar"><i style="width:' + pct + '%"></i></div>' +
        '<p>' + r.host + '</p>' +
        '<p class="reset">Resets <b>' + nextResetDate() + '</b></p></div>';
    }).join('');
    renderStats();
  }

  /* ---------- dashboard stats + trend (all from REAL local data) ---------- */
  function sumQuotaAll() {
    const q = loadQuota(); let total = 0;
    Object.values(q).forEach(m => Object.values(m).forEach(n => { total += Number(n) || 0; }));
    return total;
  }
  function sumQuotaMonth(d) {
    const q = loadQuota(); const m = monthKey(d);
    return Object.values(q[m] || {}).reduce((s, n) => s + (Number(n) || 0), 0);
  }
  function renderStats() {
    const h = loadHistory();
    const totalDownloads = h.length;                 // every logged fetch, all time
    const urlsProcessed = sumQuotaAll();             // every Fetch = 1 URL processed
    const thisMonth = sumQuotaMonth(new Date());     // quota used this month
    const totalLimit = Object.values(settings.limits).reduce((s, n) => s + (Number(n) || 0), 0);
    const available = Math.max(0, totalLimit - thisMonth);
    if (el.statTotal) el.statTotal.textContent = totalDownloads.toLocaleString('en-US');
    if (el.statUrls) el.statUrls.textContent = urlsProcessed.toLocaleString('en-US');
    if (el.statMonth) el.statMonth.textContent = thisMonth.toLocaleString('en-US');
    if (el.statApi) el.statApi.textContent = available.toLocaleString('en-US');
    if (el.trendThisMonth) el.trendThisMonth.textContent = thisMonth.toLocaleString('en-US');
    drawTrend();
  }
  function historyDateKey(d) { // history stores en-GB dates (DD/MM/YYYY)
    return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear();
  }
  function trendCounts(days) {
    const h = loadHistory();
    const out = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = historyDateKey(d);
      out.push({ label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), count: h.filter(x => x.date === key).length });
    }
    return out;
  }
  function drawTrend() {
    const cv = el.trendChart; if (!cv) return;
    const data = trendCounts(trendDays);
    const total = data.reduce((s, x) => s + x.count, 0);
    if (el.trendEmpty) el.trendEmpty.style.display = total === 0 ? 'block' : 'none';
    // Change vs the previous equal-length period (real, computed — never invented).
    const prev = (() => {
      const h = loadHistory(); let n = 0;
      for (let i = trendDays; i < trendDays * 2; i++) {
        const d = new Date(); d.setDate(d.getDate() - i);
        n += h.filter(x => x.date === historyDateKey(d)).length;
      }
      return n;
    })();
    if (el.trendChange) {
      if (total === 0 && prev === 0) { el.trendChange.textContent = 'No data yet'; el.trendChange.className = 'trend-pill flat'; }
      else if (prev === 0) { el.trendChange.textContent = '▲ New this period'; el.trendChange.className = 'trend-pill'; }
      else {
        const pct = Math.round((total - prev) / prev * 100);
        el.trendChange.textContent = (pct >= 0 ? '▲ +' : '▼ ') + pct + '%';
        el.trendChange.className = 'trend-pill' + (pct < 0 ? ' down' : '');
      }
    }
    const ctx = cv.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth || 600, hgt = 220;
    cv.width = w * dpr; cv.height = hgt * dpr; cv.style.height = hgt + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hgt);
    const padL = 34, padR = 48, padT = 12, padB = 26;
    const maxV = Math.max(1, ...data.map(x => x.count));
    const xAt = i => padL + (data.length === 1 ? (w - padL - padR) / 2 : i * (w - padL - padR) / (data.length - 1));
    const yAt = v => padT + (1 - v / maxV) * (hgt - padT - padB);
    // gridlines + y labels (0..max)
    ctx.font = '11px Archivo, sans-serif'; ctx.fillStyle = '#a9a7a2';
    ctx.strokeStyle = 'rgba(255,255,255,.08)'; ctx.lineWidth = 1;
    const steps = Math.min(5, maxV);
    for (let s = 0; s <= steps; s++) {
      const v = Math.round(maxV * s / steps), y = yAt(v);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      ctx.fillText(String(v), 6, y + 4);
    }
    // x labels (thin out for 30 days). Anchor the first label left and the
    // last label right so neither runs past the canvas edge (the last label
    // used to clip to "Nov 1" instead of "Nov 11").
    const step = data.length > 14 ? 5 : data.length > 7 ? 2 : 1;
    data.forEach((d, i) => {
      if (i % step === 0 || i === data.length - 1) {
        ctx.textAlign = i === 0 ? 'left' : i === data.length - 1 ? 'right' : 'center';
        ctx.fillText(d.label, xAt(i), hgt - 8);
      }
    });
    ctx.textAlign = 'left';
    // area fill + line + dots (red gradient, like the reference)
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

  /* ---------- history (localStorage) ---------- */
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(STORE.history) || '[]'); } catch { return []; }
  }
  function renderHistory() {
    const h = loadHistory();
    if (!h.length) { el.historyList.innerHTML = '<p class="empty">No downloads yet — paste a link above and press Fetch.</p>'; if (el.viewAllBtn) el.viewAllBtn.style.display = 'none'; return; }
    if (el.viewAllBtn) { el.viewAllBtn.style.display = ''; el.viewAllBtn.textContent = showAllHistory ? 'Show less ↑' : 'View All →'; }
    const shown = showAllHistory ? h.slice(0, 100) : h.slice(0, 6);
    const platIcon = { instagram: '◉', youtube: '▶', facebook: 'f', allinone: '♪' };
    el.historyList.innerHTML = '<table class="history-table"><thead><tr><th>#</th><th>Platform</th><th>Video Title</th><th>Format</th><th>Downloaded On</th><th></th></tr></thead><tbody>' +
      shown.map((item, i) =>
        '<tr><td data-label="#">' + (i + 1) + '</td>' +
        '<td data-label="Platform"><span class="plat"><i>' + (platIcon[item.platform] || '▶') + '</i>' + escapeHtml(item.platform) + '</span></td>' +
        '<td data-label="Video Title"><div class="h-title">' + escapeHtml(item.video_url) + '</div>' +
        '<div class="h-sub">' + escapeHtml(item.tool || '') + ' · ' + escapeHtml(item.city || 'unknown location') + '</div></td>' +
        '<td data-label="Format"><span class="fmt-pill">' + escapeHtml(item.format || item.quality || '—') + '</span></td>' +
        '<td data-label="Downloaded On">' + escapeHtml(item.date + ' ' + item.time) + '</td>' +
        '<td data-label="" class="h-action"><button class="icon-btn" data-copy-url="' + escapeHtml(item.video_url) + '" title="Copy video link">⧉</button></td></tr>'
      ).join('') + '</tbody></table>';
    el.historyList.querySelectorAll('[data-copy-url]').forEach(b => b.addEventListener('click', () => copyText(b.dataset.copyUrl, 'Video link copied ✓')));
    renderStats();
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  /* ---------- platform auto-detect ---------- */
  function detectPlatform(url) {
    const u = (url || '').toLowerCase();
    if (/instagram\.com/.test(u)) {
      if (/\/stories?\//.test(u) || /\/stories\//.test(u)) return { platform: 'instagram', kind: 'story' };
      if (/\/reel(s)?\//.test(u) || /\/p\//.test(u) || /\/tv\//.test(u)) return { platform: 'instagram', kind: 'reel' };
      return { platform: 'instagram', kind: 'profile' };
    }
    if (/facebook\.com|fb\.watch/.test(u)) return { platform: 'facebook', kind: 'video' };
    if (/youtube\.com\/shorts|youtu\.be/.test(u)) return { platform: 'youtube', kind: 'short' };
    if (/youtube\.com\/watch|youtube\.com\/embed|music\.youtube\.com/.test(u)) return { platform: 'youtube', kind: 'video' };
    return { platform: null, kind: null };
  }
  function bucketFor(platform, tool) {
    if (tool === 'to_song') return 'allinone';
    if (platform === 'facebook') return 'allinone'; // FB goes through the all-in-one API
    return platform || 'allinone';
  }

  /* ---------- device + location (GPS-first) ---------- */
  function detectDevice() {
    const ua = navigator.userAgent || '';
    const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
    const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Unknown';
    return (mobile ? 'Mobile' : 'Desktop') + ' · ' + os + ' · ' + window.innerWidth + 'x' + window.innerHeight;
  }
  function getLocation() {
    // GPS first; fall back to IP geolocation (ipapi.co) — same approach as
    // the portfolio (IP alone once showed the wrong town).
    return new Promise(resolve => {
      const done = (loc) => resolve(loc);
      const fallback = () => {
        fetch('https://ipapi.co/json/').then(r => r.json()).then(j => done({
          city: [j.city, j.region, j.country_name].filter(Boolean).join(', ') || 'Unknown',
          lat: j.latitude, lng: j.longitude, source: 'IP'
        })).catch(() => done({ city: 'Unknown', lat: '', lng: '', source: 'none' }));
      };
      if (!navigator.geolocation) return fallback();
      navigator.geolocation.getCurrentPosition(
        pos => done({ city: 'GPS location', lat: pos.coords.latitude, lng: pos.coords.longitude, source: 'GPS' }),
        () => fallback(),
        { timeout: 6000, maximumAge: 60000 }
      );
      setTimeout(fallback, 7000); // never block the log on a GPS prompt
    });
  }

  /* ---------- Sheets logging ---------- */
  async function logToSheet(entry) {
    // 1) Always keep a local copy.
    const h = loadHistory(); h.unshift(entry);
    localStorage.setItem(STORE.history, JSON.stringify(h.slice(0, 200)));
    renderHistory();
    // 2) If an Apps Script URL is set, POST the same row there.
    if (!settings.appsScriptUrl) {
      setStatus('Saved to local history. (Sheet logging needs the Apps Script URL saved in this browser.)', 'info');
      return;
    }
    try {
      await fetch(settings.appsScriptUrl, {
        method: 'POST', mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain' },
        body: JSON.stringify(entry)
      });
      setStatus('Logged to Google Sheet ✓ (tab: downloader_data).', 'ok');
    } catch (e) {
      setStatus('Saved locally, but the Sheet log failed — check the saved Apps Script URL.', 'err');
    }
  }

  /* ---------- status ---------- */
  function setStatus(msg, type) {
    el.status.className = 'status show ' + (type || 'info');
    el.status.innerHTML = msg;
  }
  function clearStatus() { el.status.className = 'status'; el.status.innerHTML = ''; }

  /* ---------- converter progress (mirrors the real download progress) ---------- */
  function showConvertProgress(pct, text) {
    if (!el.convertProgress) return;
    el.convertProgress.classList.add('show');
    if (el.convertBar) el.convertBar.style.width = pct + '%';
    if (el.convertText) el.convertText.textContent = text;
  }
  function hideConvertProgress() { if (el.convertProgress) el.convertProgress.classList.remove('show'); }
  function mirrorDownloadProgress() {
    if (!el.convertProgress || !el.convertProgress.classList.contains('show')) return;
    if (el.convertBar) el.convertBar.style.width = el.progressBar.style.width;
    if (el.convertText) el.convertText.textContent = el.progressText.textContent;
  }

  /* ---------- API calls ---------- */
  function needKey() {
    if (!settings.rapidapiKey) {
      setStatus('No RapidAPI key is available — the built-in key is missing. (Or press “Demo preview” to see the layout without a key.)', 'err');
      return false;
    }
    return true;
  }

  async function fetchInstagram(url) {
    const res = await fetch('https://' + API_HOSTS.instagram + '/fetch?url=' + encodeURIComponent(url), {
      headers: { 'x-rapidapi-host': API_HOSTS.instagram, 'x-rapidapi-key': settings.rapidapiKey }
    });
    if (!res.ok) throw new Error('Instagram API returned HTTP ' + res.status + ' — check your subscription on RapidAPI.');
    const data = await res.json();
    if (!data.ok) throw new Error('Instagram API error: ' + JSON.stringify(data).slice(0, 200));
    // Shape: { ok, download_url, thumbnail_url, caption, width, height,
    //          items: [{ download_url, thumbnail_url, ... }] } — carousel = items[].
    const item = (data.items && data.items[0]) || data;
    return {
      title: data.caption ? data.caption.slice(0, 120) : 'Instagram video',
      caption: data.caption || '',
      author: data.username || data.owner || '',
      thumbnail: data.thumbnail_url || item.thumbnail_url || '',
      duration: '',
      formats: [{
        quality: '720p HD', label: 'HD video', ext: 'mp4',
        url: item.download_url || data.download_url
      }].filter(f => f.url)
    };
  }

  async function fetchAllInOne(url) {
    const res = await fetch('https://' + API_HOSTS.allinone + '/extract', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-rapidapi-host': API_HOSTS.allinone, 'x-rapidapi-key': settings.rapidapiKey
      },
      body: JSON.stringify({ url })
    });
    if (!res.ok) throw new Error('All-in-one API returned HTTP ' + res.status + ' — check your subscription on RapidAPI.');
    const data = await res.json();
    // Shape: { title, thumbnail, duration, formats: [{ quality, url, ext, filesize }] }
    const formats = (data.formats || data.medias || []).map(f => ({
      quality: f.quality || f.label || (f.ext === 'mp3' || f.ext === 'm4a' ? 'Audio' : 'Video'),
      label: (f.ext || 'mp4').toUpperCase() + (f.filesize ? ' · ' + fmtSize(f.filesize) : ''),
      ext: (f.ext || 'mp4').toLowerCase(),
      url: f.url
    })).filter(f => f.url);
    if (!formats.length && data.url) formats.push({ quality: 'Original', label: 'MP4', ext: 'mp4', url: data.url });
    if (!formats.length) throw new Error('No downloadable formats returned for this link.');
    return {
      title: data.title || 'Video',
      caption: data.description || data.caption || '',
      author: data.author || data.uploader || '',
      thumbnail: data.thumbnail || data.thumb || '',
      duration: data.duration ? fmtDuration(data.duration) : '',
      formats
    };
  }

  async function fetchYouTube(url) {
    // youtube-downloader24: check that API's own docs for its exact
    // endpoint/params — the call below uses the common /extract-style
    // shape and normalises whatever formats array comes back. If the
    // subscribed YT API uses a different path, update API_HOSTS.youtube
    // and this function to match its docs.
    const res = await fetch('https://' + API_HOSTS.youtube + '/extract?url=' + encodeURIComponent(url), {
      headers: { 'x-rapidapi-host': API_HOSTS.youtube, 'x-rapidapi-key': settings.rapidapiKey }
    });
    if (!res.ok) throw new Error('YouTube API returned HTTP ' + res.status + ' — check the endpoint/params in that API\'s RapidAPI docs and your subscription.');
    const data = await res.json();
    const formats = (data.formats || data.links || data.medias || []).map(f => ({
      quality: f.quality || f.label || 'Video',
      label: (f.ext || f.format || 'mp4').toUpperCase() + (f.filesize ? ' · ' + fmtSize(f.filesize) : ''),
      ext: ((f.ext || 'mp4').toLowerCase()),
      url: f.url
    })).filter(f => f.url);
    if (!formats.length && data.url) formats.push({ quality: 'Original', label: 'MP4', ext: 'mp4', url: data.url });
    if (!formats.length) throw new Error('No downloadable formats returned for this YouTube link.');
    return {
      title: data.title || 'YouTube video',
      caption: data.description || '',
      author: data.author || data.channel || '',
      thumbnail: data.thumbnail || '',
      duration: data.duration ? fmtDuration(data.duration) : '',
      formats
    };
  }

  function fmtSize(b) {
    b = Number(b); if (!b) return '';
    return b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.round(b / 1024) + ' KB';
  }
  function fmtDuration(s) {
    s = Number(s); if (!s) return '';
    const m = Math.floor(s / 60), sec = Math.round(s % 60);
    return m + ':' + String(sec).padStart(2, '0');
  }

  /* ---------- fetch flow ---------- */
  async function handleFetch() {
    const url = el.urlInput.value.trim();
    if (!url) { setStatus('Paste a video URL first.', 'err'); return; }
    let detected = detectPlatform(url);
    if (!detected.platform) {
      setStatus('That link was not recognised. Paste an Instagram, Facebook or YouTube video link.', 'err');
      return;
    }
    // Tool-specific routing: DP / Bio / Story go through the all-in-one API.
    const tool = currentTool;
    if (tool === 'ig_dp' || tool === 'ig_bio' || tool === 'ig_story') detected = { platform: 'instagram', kind: tool === 'ig_story' ? 'story' : 'profile' };
    if (tool === 'fb_video') detected = { platform: 'facebook', kind: 'video' };
    if (tool === 'yt_short' || tool === 'yt_full') detected = { platform: 'youtube', kind: tool === 'yt_short' ? 'short' : 'video' };

    const bucket = bucketFor(detected.platform, tool);
    if (isHostDisabled(bucket) || (detected.platform === 'facebook' && isHostDisabled('facebook'))) {
      setStatus('This service is temporarily disabled by the admin. Please try another platform.', 'err');
      return;
    }
    if (quotaLeft(bucket) <= 0) {
      setStatus('Monthly limit reached for ' + bucket + ' (' + settings.limits[bucket] + '/month). It resets ' + nextResetDate() + '.', 'err');
      return;
    }
    if (!needKey()) return;

    el.fetchBtn.disabled = true;
    el.fetchBtn.textContent = 'Fetching…';
    setStatus('<span class="spinner"></span>Checking the video… (uses 1 API call)', 'info');
    if (tool === 'to_song') showConvertProgress(20, 'Converting… fetching the audio stream from the API');
    el.previewCard.classList.remove('show');

    try {
      let result;
      if (detected.platform === 'instagram' && (tool === 'ig_reel' || tool === 'ig_caption' || tool === 'dashboard')) {
        result = await fetchInstagram(url);
      } else if (detected.platform === 'youtube' && tool !== 'to_song') {
        result = await fetchYouTube(url).catch(() => fetchAllInOne(url)); // YT fallback: all-in-one
      } else {
        result = await fetchAllInOne(url); // Facebook, Story, DP, Bio, Video-to-Song
      }

      // Video-to-Song: keep audio-only formats when the API provides them.
      if (tool === 'to_song') {
        const audio = result.formats.filter(f => /mp3|m4a|aac|audio/i.test(f.ext + ' ' + f.quality));
        if (audio.length) result.formats = audio;
        const wanted = audio.filter(f => (f.ext || '').toLowerCase() === audioFormatChoice);
        if (wanted.length) result.formats = wanted; // prefer the format picked in the converter
        // WAV is never returned by the API and cannot be transcoded in the
        // browser: picking WAV falls back to the MP3/M4A stream, and the
        // preview note says so plainly instead of pretending a WAV exists.
        result.wavFallback = audioFormatChoice === 'wav' &&
          !result.formats.some(f => (f.ext || '').toLowerCase() === 'wav');
        result.isAudio = true;
      }

      bumpQuota(bucket); // count AFTER a successful fetch
      currentResult = Object.assign(result, { sourceUrl: url, platform: detected.platform, tool, bucket });
      renderPreview(result);
      if (tool === 'to_song') showConvertProgress(100, 'Audio ready — pick a format above, then press Download.');
      setStatus('Video found ✓ — pick a quality, then Download. (1 ' + bucket + ' call used, ' + quotaLeft(bucket) + ' left this month.)', 'ok');
      await logFetch(url, detected.platform, tool, bucket);
    } catch (e) {
      if (tool === 'to_song') showConvertProgress(0, 'Conversion failed — try again with a different link.');
      setStatus('Could not fetch this video: ' + escapeHtml(e.message || e), 'err');
    } finally {
      el.fetchBtn.disabled = false;
      el.fetchBtn.textContent = '▶ Get Video';
    }
  }

  async function logFetch(url, platform, tool, bucket) {
    const now = new Date();
    const loc = await getLocation();
    const entry = {
      date: now.toLocaleDateString('en-GB'),
      time: now.toLocaleTimeString('en-GB'),
      device: detectDevice(),
      platform, tool, video_url: url,
      quality: (selectedQuality && selectedQuality.quality) || '',
      format: (selectedQuality && selectedQuality.ext || '').toUpperCase(),
      city: loc.city + (loc.source ? ' (' + loc.source + ')' : ''),
      lat: loc.lat, lng: loc.lng,
      mapsLink: (loc.lat !== '' && loc.lng !== '')
        ? 'https://maps.google.com/?q=' + loc.lat + ',' + loc.lng : ''
    };
    await logToSheet(entry);
  }

  /* ---------- preview ---------- */
  function renderPreview(r) {
    selectedQuality = null;
    el.previewCard.classList.add('show');
    el.previewTitle.textContent = r.title || 'Untitled video';
    el.previewAuthor.innerHTML = r.author ? 'By <b>' + escapeHtml(r.author) + '</b>' : '';
    if (r.caption) { el.previewCaption.style.display = 'block'; el.previewCaption.textContent = r.caption; }
    else el.previewCaption.style.display = 'none';
    if (r.duration) { el.previewDuration.style.display = 'block'; el.previewDuration.textContent = r.duration; }
    else el.previewDuration.style.display = 'none';

    const first = r.formats[0];
    if (first) {
      el.previewVideo.style.display = 'block';
      el.previewImage.style.display = 'none';
      el.previewVideo.poster = r.thumbnail || '';
      el.previewVideo.src = first.url;
      el.previewVideo.load();
    } else if (r.thumbnail) {
      el.previewVideo.style.display = 'none';
      el.previewImage.style.display = 'block';
      el.previewImage.src = r.thumbnail;
    }
    el.downloadNote.textContent = r.isAudio
      ? (r.wavFallback ? 'WAV is not returned by the API — saved as MP3 instead. ' : '') +
        'Audio download: this saves the audio stream the API returns (.mp3 / .m4a). The browser cannot transcode video locally — if the API returns video-only, pick the audio format above.'
      : 'Download saves the file straight to your Downloads folder (PC) or Files/Downloads (phone).';

    // Quality pills — IG usually returns a single 720p HD URL; YT/FB return several.
    const order = { '1080p': 1, '720p': 2, '480p': 3, '360p': 4, '240p': 5 };
    const sorted = r.formats.slice().sort((a, b) => {
      const qa = Object.keys(order).find(k => (a.quality || '').includes(k));
      const qb = Object.keys(order).find(k => (b.quality || '').includes(k));
      return (qa ? order[qa] : 9) - (qb ? order[qb] : 9);
    });
    el.qualityList.innerHTML = '';
    sorted.forEach((f, i) => {
      const b = document.createElement('button');
      b.className = 'qpill' + (i === 0 ? ' active' : '');
      b.innerHTML = escapeHtml(f.quality) + '<small>' + escapeHtml(f.label || f.ext) + '</small>';
      b.onclick = () => selectQuality(f);
      el.qualityList.appendChild(b);
      if (i === 0) selectedQuality = f;
    });
    if (!r.formats.length) el.qualityList.innerHTML = '<p class="empty">No quality options returned.</p>';
    syncQualitySelect(sorted); // YouTube / Facebook quality <select> mirrors the pills
    el.previewCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /* ---------- quality selection (pills + <select> stay in sync) ---------- */
  function selectQuality(f) {
    if (!f) return;
    selectedQuality = f;
    const idx = lastSortedFormats.indexOf(f);
    el.qualityList.querySelectorAll('.qpill').forEach((x, i) => x.classList.toggle('active', i === idx));
    if (el.qualitySelect) el.qualitySelect.value = String(idx >= 0 ? idx : 0);
    if (!currentResult || !currentResult.isAudio) { el.previewVideo.src = f.url; el.previewVideo.load(); }
  }
  function syncQualitySelect(sorted) {
    lastSortedFormats = sorted || [];
    if (!el.qualitySelect || !el.qualityRow) return;
    const page = PAGE_FOR_TOOL[currentTool] || '';
    const show = (page === 'youtube' || page === 'facebook') && lastSortedFormats.length > 0;
    el.qualityRow.style.display = show ? '' : 'none';
    if (!show) return;
    el.qualitySelect.innerHTML = lastSortedFormats.map((f, i) =>
      '<option value="' + i + '">' + escapeHtml(f.quality) + ' — ' + escapeHtml(f.label || f.ext || '') + '</option>').join('');
    const idx = lastSortedFormats.indexOf(selectedQuality);
    el.qualitySelect.value = String(idx >= 0 ? idx : 0);
  }

  /* ---------- download (anchor + blob fallback) ---------- */
  async function handleDownload() {
    if (!currentResult || !selectedQuality) { setStatus('Fetch a video first, then pick a quality.', 'err'); return; }
    const f = selectedQuality;
    const ext = (f.ext || 'mp4').replace(/[^a-z0-9]/gi, '') || 'mp4';
    const base = (currentResult.title || 'video').replace(/[^a-z0-9\-_ ]/gi, '').trim().replace(/\s+/g, '_').slice(0, 60) || 'video';
    const filename = base + '_' + f.quality.replace(/[^a-z0-9]/gi, '') + '.' + ext;

    el.progress.classList.add('show');
    el.progressBar.style.width = '15%';
    el.progressText.textContent = 'Starting download…';
    mirrorDownloadProgress();
    try {
      // Try a blob download first so the file lands in Downloads even when
      // the CDN blocks a plain anchor download (cross-origin).
      const res = await fetch(f.url);
      if (!res.ok) throw new Error('media HTTP ' + res.status);
      const total = Number(res.headers.get('content-length') || 0);
      const reader = res.body.getReader();
      const chunks = []; let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); received += value.length;
        if (total) { el.progressBar.style.width = Math.round(received / total * 100) + '%'; el.progressText.textContent = 'Downloading… ' + fmtSize(received) + (total ? ' / ' + fmtSize(total) : ''); mirrorDownloadProgress(); }
      }
      const blob = new Blob(chunks, { type: f.ext === 'mp3' ? 'audio/mpeg' : 'video/mp4' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = filename; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      el.progressBar.style.width = '100%';
      el.progressText.textContent = 'Saved: ' + filename;
      mirrorDownloadProgress();
      setStatus('Download started ✓ — check your Downloads folder.', 'ok');
    } catch (e) {
      // Fallback: direct anchor (works when the CDN allows it; the file
      // may open in a new tab on some phones — long-press → Save).
      const a = document.createElement('a');
      a.href = f.url; a.download = filename; a.target = '_blank'; a.rel = 'noopener'; a.click();
      el.progressText.textContent = 'Opened direct link — if it plays instead of saving, long-press the video → Save / Download.';
      setStatus('Direct download link opened. If it plays in a tab instead of saving, long-press → Save video.', 'info');
    }
  }

  /* ---------- demo preview (no key) ---------- */
  function loadDemo() {
    currentResult = {
      title: 'Demo Reel — sample preview (no API key used)',
      caption: 'This is a demo so you can see the layout: thumbnail, caption, quality pills and the Download button — without spending an API call.',
      author: 'demo_account', thumbnail: '', duration: '0:15',
      formats: [{ quality: '720p HD', label: 'MP4 · demo', ext: 'mp4', url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4' }],
      sourceUrl: '', platform: 'instagram', tool: currentTool, bucket: 'instagram'
    };
    renderPreview(currentResult);
    setStatus('Demo preview loaded — no API call used. Paste a real link and press Fetch to download a real video.', 'info');
  }

  /* ---------- tool switching ---------- */
  const TOOL_TEXT = {
    dashboard: ['Dash<span>board</span>', 'Paste a video link, preview it, and download in your preferred quality.'],
    ig_reel: ['Instagram <span>Reel</span>', 'Paste an Instagram Reel link — preview it, then download in HD.'],
    ig_story: ['Instagram <span>Story</span>', 'Paste a Story link (instagram.com/stories/…). Stories expire — fetch while it is still live. Uses the all-in-one API.'],
    ig_dp: ['Instagram <span>DP</span>', 'Enter a username below, or paste a profile link — downloads the full-size profile picture. Uses the all-in-one API.'],
    ig_caption: ['Copy Reel <span>Caption</span>', 'Fetch a Reel, then copy its caption to the clipboard in one tap.'],
    ig_bio: ['Copy <span>Bio</span>', 'Enter a username below — fetches the profile and copies the bio text. Uses the all-in-one API.'],
    fb_video: ['Facebook <span>Video</span>', 'Paste a Facebook video link — preview it, then download. Uses the all-in-one API.'],
    yt_short: ['YouTube <span>Short</span>', 'Paste a YouTube Shorts link (youtube.com/shorts/… or youtu.be/…) and download it.'],
    yt_full: ['YouTube <span>Video</span>', 'Paste a full YouTube video link (youtube.com/watch?v=…) and pick a quality.'],
    to_song: ['Video to <span>Song</span>', 'Paste any video link — the audio-only format is downloaded as .mp3 / .m4a (WAV is not returned by the API — picking WAV saves the MP3 stream instead). The browser cannot transcode video locally.']
  };
  const PAGE_FOR_TOOL = { dashboard: 'dashboard', ig_reel: 'instagram', ig_story: 'instagram', ig_dp: 'instagram', ig_caption: 'instagram', ig_bio: 'instagram', fb_video: 'facebook', yt_short: 'youtube', yt_full: 'youtube', to_song: 'converter' };
  function setTool(tool) {
    currentTool = tool;
    const page = PAGE_FOR_TOOL[tool] || 'dashboard';
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === page));
    // feature tabs: show the group for this page, mark the current tool's tab
    if (el.tabsBar) {
      el.tabsBar.style.display = page === 'dashboard' ? 'none' : 'block';
      document.querySelectorAll('.tabs[data-tabs]').forEach(g => { g.style.display = g.dataset.tabs === page ? 'flex' : 'none'; });
      document.querySelectorAll('.tab[data-tab-tool]').forEach(t => t.classList.toggle('active', t.dataset.tabTool === tool));
    }
    if (el.statRow) el.statRow.style.display = page === 'dashboard' ? '' : 'none';
    if (el.trendCard) el.trendCard.style.display = page === 'dashboard' ? '' : 'none';
    if (el.quickActions) el.quickActions.style.display = page === 'dashboard' ? '' : 'none';
    if (el.qualityRow) el.qualityRow.style.display = 'none'; // renderPreview shows it again for YT/FB
    if (page !== 'converter') hideConvertProgress();
    if (el.converterCard) el.converterCard.style.display = page === 'converter' ? '' : 'none';
    if (page === 'dashboard') renderStats();
    const t = TOOL_TEXT[tool] || TOOL_TEXT.dashboard;
    el.pageTitle.innerHTML = t[0]; el.pageSub.textContent = t[1];
    el.fetchTitle.textContent = tool === 'dashboard' ? 'Download a Video'
      : tool === 'ig_dp' ? 'Instagram username / profile URL'
      : tool === 'ig_bio' ? 'Instagram username / profile URL'
      : tool === 'to_song' ? 'Paste video URL to extract the song'
      : 'Paste video URL';
    el.fetchHint.textContent = t[1];
    el.usernameRow.style.display = (tool === 'ig_dp' || tool === 'ig_bio') ? 'block' : 'none';
    el.sidebar.classList.remove('open'); el.backdrop.classList.remove('show');
    clearStatus();
  }

  /* ---------- copy helpers ---------- */
  async function copyText(text, okMsg) {
    try { await navigator.clipboard.writeText(text); setStatus(okMsg, 'ok'); }
    catch {
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); ta.remove(); setStatus(okMsg, 'ok');
    }
  }

  /* ---------- settings panel (removed from the user app 2026-11-11:
     no Settings section in index.html any more. The form fields are
     gone, so these functions must do nothing instead of crashing
     on the missing elements. Values already saved in localStorage
     keep working — loadSettings() still reads them.) ---------- */
  function renderSettings() {
    if (!el.apiKeyInput || !el.appsScriptInput) return;
    el.apiKeyInput.value = settings.rapidapiKey || '';
    el.appsScriptInput.value = settings.appsScriptUrl || '';
    $('limitIg').value = settings.limits.instagram;
    $('limitYt').value = settings.limits.youtube;
    $('limitFb').value = settings.limits.facebook;
    $('limitAll').value = settings.limits.allinone;
  }
  function saveSettingsFromForm() {
    if (!el.apiKeyInput || !el.appsScriptInput) return;
    settings = {
      rapidapiKey: el.apiKeyInput.value.trim(),
      appsScriptUrl: el.appsScriptInput.value.trim(),
      limits: {
        instagram: Number($('limitIg').value) || 0,
        youtube: Number($('limitYt').value) || 0,
        facebook: Number($('limitFb').value) || 0,
        allinone: Number($('limitAll').value) || 0
      }
    };
    saveSettings(settings);
    renderQuota();
    el.settingsMsg.textContent = 'Settings saved in this browser only.';
  }

  /* ---------- wire up ---------- */
  document.querySelectorAll('.nav-item').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
  document.querySelectorAll('.tab[data-tab-tool]').forEach(t => t.addEventListener('click', () => setTool(t.dataset.tabTool)));
  document.querySelectorAll('[data-qa-tool]').forEach(b => b.addEventListener('click', () => setTool(b.dataset.qaTool)));
  if (el.qualitySelect) el.qualitySelect.addEventListener('change', () => {
    const f = lastSortedFormats[Number(el.qualitySelect.value)];
    if (f) selectQuality(f);
  });
  if (el.drawerClose) el.drawerClose.addEventListener('click', () => { el.sidebar.classList.remove('open'); el.backdrop.classList.remove('show'); });
  if (el.viewAllBtn) el.viewAllBtn.addEventListener('click', () => { showAllHistory = !showAllHistory; renderHistory(); });
  if (el.trendRange) el.trendRange.addEventListener('change', () => { trendDays = Number(el.trendRange.value) || 7; drawTrend(); });
  if (el.convertBtn) el.convertBtn.addEventListener('click', () => { if (currentTool !== 'to_song') setTool('to_song'); handleFetch(); });
  if (el.audioFormat) el.audioFormat.addEventListener('change', () => { audioFormatChoice = el.audioFormat.value; });
  if (el.audioQuality) el.audioQuality.addEventListener('change', () => { audioQualityChoice = el.audioQuality.value; });
  if (el.audioFileInput) el.audioFileInput.addEventListener('change', () => {
    const f = el.audioFileInput.files && el.audioFileInput.files[0];
    if (el.audioFileName) el.audioFileName.textContent = f ? 'Chosen: ' + f.name + ' — uploads are not converted in the browser; paste a video URL above to extract audio via the API.' : 'No file chosen.';
  });
  let trendResizeT = null;
  window.addEventListener('resize', () => { clearTimeout(trendResizeT); trendResizeT = setTimeout(drawTrend, 200); });
  el.hamburger.addEventListener('click', () => { el.sidebar.classList.add('open'); el.backdrop.classList.add('show'); });
  el.backdrop.addEventListener('click', () => { el.sidebar.classList.remove('open'); el.backdrop.classList.remove('show'); });
  el.fetchBtn.addEventListener('click', handleFetch);
  el.urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleFetch(); });
  el.downloadBtn.addEventListener('click', handleDownload);
  $('demoBtn').addEventListener('click', loadDemo);
  $('pasteBtn').addEventListener('click', async () => {
    try { const t = await navigator.clipboard.readText(); if (t) { el.urlInput.value = t.trim(); setStatus('Pasted from clipboard.', 'info'); } }
    catch { setStatus('Clipboard read was blocked — paste with Ctrl+V / long-press instead.', 'err'); }
  });
  document.querySelectorAll('[data-sample]').forEach(b => b.addEventListener('click', () => { el.urlInput.value = b.dataset.sample; el.urlInput.focus(); }));
  el.copyCaptionBtn.addEventListener('click', () => {
    if (currentResult && currentResult.caption) copyText(currentResult.caption, 'Caption copied to clipboard ✓');
    else setStatus('No caption on this video — fetch a Reel first.', 'err');
  });
  el.copyLinkBtn.addEventListener('click', () => {
    const link = selectedQuality ? selectedQuality.url : (currentResult && currentResult.sourceUrl);
    if (link) copyText(link, 'Video link copied ✓');
    else setStatus('Nothing to copy yet — fetch a video first.', 'err');
  });
  el.usernameBtn.addEventListener('click', () => {
    const u = el.usernameInput.value.trim().replace(/^@/, '');
    if (!u) { setStatus('Enter an Instagram username first.', 'err'); return; }
    el.urlInput.value = 'https://www.instagram.com/' + u + '/';
    handleFetch();
  });
  $('clearHistoryBtn').addEventListener('click', () => { localStorage.removeItem(STORE.history); renderHistory(); });
  $('exportHistoryBtn').addEventListener('click', () => {
    const h = loadHistory();
    const csv = 'Date,Time,Device,Platform,Tool,Video URL,Quality,City,Latitude,Longitude,Maps Link\n' +
      h.map(r => [r.date, r.time, '"' + (r.device || '').replace(/"/g, '""') + '"', r.platform, r.tool, r.video_url, r.quality, '"' + (r.city || '').replace(/"/g, '""') + '"', r.lat, r.lng, r.mapsLink].join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'downloader_history.csv'; a.click();
  });
  // Settings buttons were removed with the Settings section (2026-11-11);
  // guard so the missing elements cannot throw at startup.
  if ($('saveSettingsBtn')) $('saveSettingsBtn').addEventListener('click', saveSettingsFromForm);
  if ($('toggleKeyBtn')) $('toggleKeyBtn').addEventListener('click', () => {
    const show = el.apiKeyInput.type === 'password';
    el.apiKeyInput.type = show ? 'text' : 'password';
    $('toggleKeyBtn').textContent = show ? 'Hide key' : 'Show key';
  });
  if ($('testSheetBtn')) $('testSheetBtn').addEventListener('click', async () => {
    saveSettingsFromForm();
    if (!settings.appsScriptUrl) { el.settingsMsg.textContent = 'Paste your Apps Script web-app URL first.'; return; }
    try {
      const r = await fetch(settings.appsScriptUrl + (settings.appsScriptUrl.includes('?') ? '&' : '?') + 'action=count');
      const j = await r.json();
      el.settingsMsg.textContent = 'Sheet connected ✓ — ' + (j.count != null ? j.count + ' rows this month in downloader_data.' : JSON.stringify(j));
    } catch (e) { el.settingsMsg.textContent = 'Could not reach the Apps Script URL — check it is deployed as Web App, Execute as Me, Anyone.'; }
  });

  // Auto-detect platform as the user pastes, and switch the tool label.
  el.urlInput.addEventListener('input', () => {
    const d = detectPlatform(el.urlInput.value.trim());
    if (!d.platform) return;
    const map = { reel: 'ig_reel', story: 'ig_story', profile: 'ig_dp', short: 'yt_short', video: currentTool === 'fb_video' ? 'fb_video' : (d.platform === 'facebook' ? 'fb_video' : 'yt_full') };
    if (d.platform === 'facebook') setTool('fb_video');
    else if (map[d.kind] && currentTool === 'dashboard') setTool(map[d.kind]);
  });

  applyAppSettings();
  renderQuota();
  renderHistory();
  renderSettings();
})();
