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
  const { API_HOSTS, DEFAULT_LIMITS, STORE, TOOLS, DEFAULT_RAPIDAPI_KEY, DEFAULT_SCRAPPA_KEY } = CFG;

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
    convertProgress: $('convertProgress'), convertBar: $('convertBar'), convertText: $('convertText'),
    fetchCard: $('fetchCard')
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
        scrappaKey: s.scrappaKey || DEFAULT_SCRAPPA_KEY || '',
        appsScriptUrl: s.appsScriptUrl || '',
        limits: Object.assign({}, DEFAULT_LIMITS, appSettings.limits || {}, s.limits || {})
      };
    } catch { return { rapidapiKey: DEFAULT_RAPIDAPI_KEY || '', scrappaKey: DEFAULT_SCRAPPA_KEY || '', appsScriptUrl: '', limits: Object.assign({}, DEFAULT_LIMITS, appSettings.limits || {}) }; }
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
      { bucket: 'allinone',  label: 'All-in-one', host: API_HOSTS.allinone },
      { bucket: 'ig_profile', label: 'IG Profile (DP/Bio)', host: API_HOSTS.scrappa + ' (Scrappa, free 500/mo)' }
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
    if (!h.length) { el.historyList.innerHTML = '<p class="empty">No downloads yet — pick a tool from Quick Actions and fetch a video.</p>'; if (el.viewAllBtn) el.viewAllBtn.style.display = 'none'; return; }
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
    if (tool === 'ig_dp' || tool === 'ig_bio') return 'ig_profile'; // DP/Bio use the profile API
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
    // youtube-downloader24 (verified 2026-11-11 on its RapidAPI page):
    // GET /api/getVideoData?videoUrlId=<full YouTube URL> — the old
    // /extract?url= path does not exist on this API. /api/getAllData
    // returns video+audio+thumbnails; /api/getAudioData returns audio.
    // Response shape is normalised defensively (formats/links/medias/
    // videos) — confirm against a real subscribed call if it ever
    // returns "No downloadable formats".
    const res = await fetch('https://' + API_HOSTS.youtube + '/api/getVideoData?videoUrlId=' + encodeURIComponent(url), {
      headers: { 'x-rapidapi-host': API_HOSTS.youtube, 'x-rapidapi-key': settings.rapidapiKey }
    });
    if (!res.ok) throw new Error('YouTube API returned HTTP ' + res.status + ' — check your subscription on RapidAPI.');
    const data = await res.json();
    const list = data.formats || data.links || data.medias || data.videos || data.video || [];
    const formats = (Array.isArray(list) ? list : [list]).map(f => ({
      quality: f.quality || f.label || f.resolution || 'Video',
      label: (f.ext || f.format || 'mp4').toUpperCase() + (f.filesize || f.size ? ' · ' + fmtSize(f.filesize || f.size) : ''),
      ext: ((f.ext || 'mp4').toLowerCase()),
      url: f.url || f.link
    })).filter(f => f.url);
    if (!formats.length && data.url) formats.push({ quality: 'Original', label: 'MP4', ext: 'mp4', url: data.url });
    if (!formats.length) throw new Error('No downloadable formats returned for this YouTube link.');
    return {
      title: data.title || 'YouTube video',
      caption: data.description || '',
      author: data.author || data.channel || '',
      thumbnail: data.thumbnail || data.thumbnail_url || (Array.isArray(data.thumbnails) && data.thumbnails[0] && data.thumbnails[0].url) || '',
      duration: data.duration ? fmtDuration(data.duration) : '',
      formats
    };
  }

  /* ---------- profile input: URL, username or account ID ---------- */
  const PROFILE_RESERVED = new Set(['reel', 'reels', 'p', 'tv', 'stories', 'story', 'explore', 'accounts', 'direct', 'about', 'legal', 'developer', 'settings', 'igtv', 'home', 'search']);
  function profileInputOf(raw) {
    // Accepts a full profile link, a bare username, "@username", or a
    // numeric account ID. Returns { username } or { id }, or null when
    // the input is not a profile at all (a reel link, google.com, …).
    let s = (raw || '').trim();
    if (!s) return null;
    if (/^\d+$/.test(s)) return { id: s };
    const m = s.match(/^(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9._]+)\/?(?:[?#].*)?$/i);
    if (m) {
      const name = m[1];
      if (!PROFILE_RESERVED.has(name.toLowerCase())) return { username: name };
      return null;
    }
    s = s.replace(/^@/, '');
    if (/^[A-Za-z0-9._]{1,30}$/.test(s) && !PROFILE_RESERVED.has(s.toLowerCase()) && !/\.(com|net|org|io|in)$/i.test(s)) return { username: s };
    return null;
  }

  /* ---------- per-section URL validation ----------
     Each tool only accepts links that belong to it. A Facebook link in
     the Reel section (or google.com anywhere) is rejected HERE with a
     plain message — it is never silently sent to another API. */
  function validateUrlForTool(url, tool) {
    const u = (url || '').trim().toLowerCase();
    const isIG = /instagram\.com/.test(u), isFB = /facebook\.com|fb\.watch/.test(u), isYT = /youtube\.com|youtu\.be/.test(u);
    const reelOk = isIG && /\/(reel|reels|p|tv)\/[^/]+/.test(u);
    const storyOk = isIG && /\/stories?\/[^/]+/.test(u);
    const ytShortOk = /youtube\.com\/shorts\/[^/]+/.test(u) || /youtu\.be\/[^/]+/.test(u);
    const ytFullOk = /youtube\.com\/watch/.test(u) || /youtube\.com\/embed\/[^/]+/.test(u) || /music\.youtube\.com\/watch/.test(u) || /youtu\.be\/[^/]+/.test(u);
    const fbOk = isFB && (/\/videos?\/[^/]+/.test(u) || /\/reel\/[^/]+/.test(u) || /fb\.watch\/[^/]+/.test(u) || /facebook\.com\/watch/.test(u));
    switch (tool) {
      case 'ig_reel': return reelOk ? null : 'This URL is invalid for Reel Download. Please paste a correct Instagram Reel link (instagram.com/reel/…).';
      case 'ig_caption': return reelOk ? null : 'This URL is invalid for Copy Reel Caption. Please paste a correct Instagram Reel link (instagram.com/reel/…).';
      case 'ig_story': return storyOk ? null : 'This URL is invalid for Story Download. Please paste a correct Instagram Story link (instagram.com/stories/…).';
      case 'ig_dp': return profileInputOf(url) ? null : 'This URL is invalid for DP Download. Please paste a correct Instagram profile link or username (instagram.com/<username>/ or just the username).';
      case 'ig_bio': return profileInputOf(url) ? null : 'This URL is invalid for Copy Bio. Please paste a correct Instagram profile link or username (instagram.com/<username>/ or just the username).';
      case 'yt_short': return ytShortOk ? null : 'This URL is invalid for Short Download. Please paste a correct YouTube Shorts link (youtube.com/shorts/…).';
      case 'yt_full': return ytFullOk ? null : 'This URL is invalid for Full Video Download. Please paste a correct YouTube video link (youtube.com/watch?v=…).';
      case 'fb_video': return fbOk ? null : 'This URL is invalid for Facebook Video Download. Please paste a correct Facebook video link.';
      case 'to_song': return (isIG && (reelOk || storyOk)) || isYT || isFB ? null : 'This URL is invalid for Video to Audio. Please paste a correct Instagram, YouTube or Facebook video link.';
      default: return null; // dashboard: auto-detect handles it
    }
  }

  /* ---------- Instagram profile (DP + Bio): the REAL profile ----------
     Scrappa — GET /api/v2/instagram/user?username=<name> (x-api-key).
     Free, no card. One call returns the bio AND the profile picture,
     so DP and Bio share it. A numeric account ID is resolved first
     with GET /api/instagram/user/basic?user_id=<id> (username + name
     + picture); Bio then needs one more call to the full endpoint.
     (The working Instagram /fetch API answers HTTP 400 for profile
     URLs, so it cannot do DP/Bio. The RapidAPI profile API is not
     used — it needs a card the owner does not have.) */
  async function scrappaError(res) {
    let msg = 'Scrappa returned HTTP ' + res.status;
    try {
      const j = await res.json();
      if (j.error) msg += ' — ' + j.error;
      else if (j.message) msg += ' — ' + j.message;
    } catch { /* body was not JSON */ }
    if (res.status === 401 || res.status === 403) msg += ' (check the saved Scrappa API key — free credits may be used up or the key may be wrong)';
    return msg;
  }
  async function fetchProfile(ref, tool) {
    if (!settings.scrappaKey) throw new Error('No Scrappa API key is saved — sign up free at scrappa.co (no card needed) and add the key.');
    const headers = { 'x-api-key': settings.scrappaKey, 'Accept': 'application/json' };
    let d;
    if (ref.id) {
      const res = await fetch('https://' + API_HOSTS.scrappa + '/api/instagram/user/basic?user_id=' + ref.id, { headers });
      if (!res.ok) throw new Error(await scrappaError(res));
      const b = await res.json();
      const bu = b.user || {};
      if (!b.found || !bu.username) throw new Error('No profile found for that account ID.');
      if (tool === 'ig_dp') {
        d = bu; // DP only needs the picture — the basic answer has it (1 call)
      } else {
        const res2 = await fetch('https://' + API_HOSTS.scrappa + '/api/v2/instagram/user?username=' + encodeURIComponent(bu.username), { headers });
        if (!res2.ok) throw new Error(await scrappaError(res2));
        const full = await res2.json();
        d = full.user || {};
        if (!full.found || !d.username) throw new Error('No profile found for that account ID.');
      }
    } else {
      const res = await fetch('https://' + API_HOSTS.scrappa + '/api/v2/instagram/user?username=' + encodeURIComponent(ref.username), { headers });
      if (!res.ok) throw new Error(await scrappaError(res));
      const data = await res.json();
      d = data.user || data.data || data;
      if (!data.found && !d.username) throw new Error('No profile found for that username.');
    }
    if (!d || (!d.username && !d.profile_pic_url && !d.id)) throw new Error('No profile found for that username.');
    return {
      username: d.username || ref.username || '', fullName: d.full_name || '',
      bio: d.biography || '', dp: d.profile_pic_url_hd || d.profile_pic_url || '',
      dpHd: !!d.profile_pic_url_hd,
      dpThumb: d.profile_pic_url || '', followers: d.follower_count,
      following: d.following_count, isPrivate: d.is_private, isVerified: d.is_verified
    };
  }

  /* ---------- in-browser audio conversion (ffmpeg.wasm) ----------
     No API, no card, no server: the video bytes are fetched (Instagram's
     CDN allows cross-origin reads) and the audio is extracted ON THE
     DEVICE with ffmpeg.wasm. Single-thread core — it works on GitHub
     Pages, which does not send the COOP/COEP headers the multi-thread
     build needs. MP3/M4A are re-encoded at the chosen bitrate; WAV is
     real PCM audio (the old "WAV falls back to MP3" is gone for this
     path). YouTube/Facebook still need their API for the video URL,
     so only Instagram + local files convert here. */
  let ffmpegInstance = null;
  let ffmpegLoading = null;
  let lastAudioBlobUrl = null;
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load the converter engine from ' + src));
      document.head.appendChild(s);
    });
  }
  async function getFFmpeg() {
    if (ffmpegInstance) return ffmpegInstance;
    if (ffmpegLoading) return ffmpegLoading;
    ffmpegLoading = (async () => {
      if (!window.FFmpegWASM || !window.FFmpegUtil) {
        await loadScript('https://unpkg.com/@ffmpeg/ffmpeg@0.12.15/dist/umd/ffmpeg.js');
        await loadScript('https://unpkg.com/@ffmpeg/util@0.12.2/dist/umd/index.js');
      }
      const ff = new window.FFmpegWASM.FFmpeg();
      const base = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/umd';
      await ff.load({
        coreURL: await window.FFmpegUtil.toBlobURL(base + '/ffmpeg-core.js', 'text/javascript'),
        wasmURL: await window.FFmpegUtil.toBlobURL(base + '/ffmpeg-core.wasm', 'application/wasm')
      });
      ffmpegInstance = ff;
      return ff;
    })();
    try { return await ffmpegLoading; }
    catch (e) { ffmpegLoading = null; throw e; } // let the next attempt retry
  }
  async function fetchBytesWithProgress(url, onProgress) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Video file returned HTTP ' + res.status);
    const total = Number(res.headers.get('content-length') || 0);
    if (!res.body) { const b = new Uint8Array(await res.arrayBuffer()); if (onProgress) onProgress(1); return b; }
    const reader = res.body.getReader();
    const chunks = []; let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); received += value.length;
      if (total && onProgress) onProgress(received / total);
    }
    const out = new Uint8Array(received);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  }
  async function convertVideoToAudio(videoBytes, title, thumbnail, onTranscode) {
    const ff = await getFFmpeg();
    const fmt = audioFormatChoice; // mp3 | m4a | wav
    const br = audioQualityChoice; // 128 | 192 | 320
    await ff.writeFile('input.mp4', videoBytes);
    const outName = 'output.' + fmt;
    const args = fmt === 'wav'
      ? ['-i', 'input.mp4', '-vn', '-codec:a', 'pcm_s16le', outName]
      : fmt === 'm4a'
        ? ['-i', 'input.mp4', '-vn', '-codec:a', 'aac', '-b:a', br + 'k', outName]
        : ['-i', 'input.mp4', '-vn', '-codec:a', 'libmp3lame', '-b:a', br + 'k', outName];
    const onProg = ({ progress }) => { if (onTranscode) onTranscode(progress || 0); };
    if (typeof ff.on === 'function') ff.on('progress', onProg);
    let code;
    try { code = await ff.exec(args); }
    finally { if (typeof ff.off === 'function') { try { ff.off('progress', onProg); } catch {} } }
    if (code !== 0) throw new Error('The converter could not extract audio from this video — it may have no audio track.');
    const data = await ff.readFile(outName);
    const mime = fmt === 'mp3' ? 'audio/mpeg' : fmt === 'm4a' ? 'audio/mp4' : 'audio/wav';
    if (lastAudioBlobUrl) { try { URL.revokeObjectURL(lastAudioBlobUrl); } catch {} }
    const url = URL.createObjectURL(new Blob([data], { type: mime }));
    lastAudioBlobUrl = url;
    const q = fmt === 'wav' ? 'WAV' : fmt.toUpperCase() + ' · ' + br + ' kbps';
    return {
      title: title || 'Converted audio', caption: '', author: '',
      thumbnail: thumbnail || '', duration: '',
      formats: [{ quality: q, label: fmt === 'wav' ? 'WAV · lossless' : fmt.toUpperCase() + ' · ' + br + ' kbps', ext: fmt, url }],
      isAudio: true, wavFallback: false, convertedLocally: true
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
    const tool = currentTool;
    // Converter file mode: a chosen local file is converted when the
    // URL box is empty (a pasted URL wins when both are given).
    const uploadFile = (tool === 'to_song' && el.audioFileInput && el.audioFileInput.files && el.audioFileInput.files[0]) || null;
    // DP / Bio read the profile from either box (main URL or helper field):
    // a full profile link, a bare username, @username, or a numeric ID.
    const rawInput = (tool === 'ig_dp' || tool === 'ig_bio')
      ? (el.urlInput.value.trim() || el.usernameInput.value.trim())
      : el.urlInput.value.trim();
    const isFileMode = !!uploadFile && !rawInput;
    if (!rawInput && !isFileMode) {
      setStatus(tool === 'ig_dp' || tool === 'ig_bio' ? 'Enter an Instagram username or profile link first.' : 'Paste a video URL first.', 'err');
      return;
    }
    let detected, profileRef = null;
    let url = rawInput;
    if (isFileMode) {
      detected = { platform: 'local', kind: 'file' };
      url = uploadFile.name;
    } else if (tool === 'ig_dp' || tool === 'ig_bio') {
      profileRef = profileInputOf(rawInput);
      if (!profileRef) {
        setStatus('This URL is invalid for ' + (tool === 'ig_dp' ? 'DP Download' : 'Copy Bio') + '. Please paste a correct Instagram profile link or username (instagram.com/<username>/ or just the username).', 'err');
        return;
      }
      detected = { platform: 'instagram', kind: 'profile' };
      if (profileRef.username) url = 'https://www.instagram.com/' + profileRef.username + '/';
    } else {
      // Strict per-section check first: a link that belongs to another
      // section (or google.com) is rejected here, never sent to the
      // wrong API. The old code forced the platform from the tool and
      // silently fetched mismatched links — that is gone.
      const bad = validateUrlForTool(rawInput, tool);
      if (bad) { setStatus(bad, 'err'); return; }
      detected = detectPlatform(rawInput);
      if (!detected.platform) {
        setStatus('That link was not recognised. Paste an Instagram, Facebook or YouTube video link.', 'err');
        return;
      }
    }

    // Converter: Instagram uses the working IG API (counts against the
    // Instagram bucket); a local file uses no API call at all.
    let bucket = bucketFor(detected.platform, tool);
    if (tool === 'to_song' && detected.platform === 'instagram') bucket = 'instagram';
    if (isFileMode) bucket = null;
    if (bucket && (isHostDisabled(bucket) || (detected.platform === 'facebook' && isHostDisabled('facebook')))) {
      setStatus('This service is temporarily disabled by the admin. Please try another platform.', 'err');
      return;
    }
    if (bucket && quotaLeft(bucket) <= 0) {
      setStatus('Monthly limit reached for ' + bucket + ' (' + settings.limits[bucket] + '/month). It resets ' + nextResetDate() + '.', 'err');
      return;
    }
    if (!isFileMode && !needKey()) return;

    el.fetchBtn.disabled = true;
    el.fetchBtn.textContent = tool === 'to_song' ? 'Converting…' : 'Fetching…';
    if (el.convertBtn) el.convertBtn.disabled = true;
    setStatus(isFileMode ? '<span class="spinner"></span>Converting your file… (no API call — it never leaves your device)' : '<span class="spinner"></span>Checking the video… (uses 1 API call)', 'info');
    if (tool === 'to_song') showConvertProgress(5, isFileMode ? 'Converting your file…' : 'Converting… loading the converter engine');
    el.previewCard.classList.remove('show');

    try {
      let result;
      if (isFileMode) {
        // Local file: no API, no upload — the audio is extracted on
        // the device with ffmpeg.wasm.
        showConvertProgress(5, 'Loading converter engine… (one-time download, ~30 MB)');
        const bytes = new Uint8Array(await uploadFile.arrayBuffer());
        result = await convertVideoToAudio(bytes, uploadFile.name.replace(/\.[^.]+$/, ''), '', p => showConvertProgress(10 + Math.round(p * 85), 'Extracting audio… ' + Math.round(p * 100) + '%'));
      } else if (profileRef) {
        // DP / Bio: Scrappa returns the REAL bio and profile picture —
        // no invented data, ever. The picture is 150x150 unless
        // Scrappa returns an HD URL (it did not for this profile).
        const p = await fetchProfile(profileRef, tool);
        const who = (p.fullName ? p.fullName + ' ' : '') + '(@' + (p.username || profileRef.username || profileRef.id || '') + ')';
        if (tool === 'ig_dp') {
          if (!p.dp) throw new Error('No profile picture found for this profile.');
          result = { title: who, caption: p.bio || '', author: p.username || '', thumbnail: p.dpThumb || p.dp, duration: '', formats: [{ quality: 'Profile picture', label: p.dpHd ? 'JPG · HD' : 'JPG · 150×150', ext: 'jpg', url: p.dp }] };
        } else {
          if (!p.bio) throw new Error('This profile has no bio text.');
          result = { title: who, caption: p.bio, author: p.username || '', thumbnail: p.dpThumb || p.dp, duration: '', formats: [] };
        }
      } else if (detected.platform === 'instagram' && (tool === 'ig_reel' || tool === 'ig_caption' || tool === 'dashboard')) {
        result = await fetchInstagram(url);
      } else if (tool === 'to_song' && detected.platform === 'instagram') {
        // Instagram converter: fetch the real video with the working IG
        // API, then extract the audio IN THE BROWSER — no card, no server.
        const vid = await fetchInstagram(url);
        const vurl = (vid.formats[0] && vid.formats[0].url) || '';
        if (!vurl) throw new Error('No video file was returned for this link.');
        const enginePromise = getFFmpeg(); // load while the video downloads
        const bytes = await fetchBytesWithProgress(vurl, p => showConvertProgress(5 + Math.round(p * 30), 'Downloading the video… ' + Math.round(p * 100) + '%'));
        await enginePromise;
        result = await convertVideoToAudio(bytes, vid.title, vid.thumbnail, p => showConvertProgress(40 + Math.round(p * 55), 'Extracting audio… ' + Math.round(p * 100) + '%'));
      } else if (tool === 'to_song') {
        // YouTube / Facebook audio still needs their API for the video
        // URL — say so plainly instead of showing a confusing 404.
        throw new Error('YouTube and Facebook audio still need their API subscription on RapidAPI (it asks for a card). Instagram Reels convert now — paste an Instagram Reel link, or upload a video file below.');
      } else if (detected.platform === 'youtube' && tool !== 'to_song') {
        result = await fetchYouTube(url).catch(() => fetchAllInOne(url)); // YT fallback: all-in-one
      } else {
        result = await fetchAllInOne(url); // Facebook, Story
      }

      // Video-to-Song: keep audio-only formats when the API provides them.
      // (Converted results already hold exactly the chosen format.)
      if (tool === 'to_song' && !result.convertedLocally) {
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

      if (bucket) bumpQuota(bucket); // count AFTER a successful fetch (file mode uses no API call)
      currentResult = Object.assign(result, { sourceUrl: url, platform: detected.platform, tool, bucket });
      renderPreview(result);
      if (tool === 'to_song') showConvertProgress(100, 'Audio ready — press Download to save it.');
      if (isFileMode) setStatus('Audio extracted from your file ✓ — press Download to save it. (No API call used.)', 'ok');
      else if (tool === 'to_song') setStatus('Audio extracted in your browser ✓ — press Download to save it. (1 ' + bucket + ' call used, ' + quotaLeft(bucket) + ' left this month.)', 'ok');
      else setStatus('Video found ✓ — pick a quality, then Download. (1 ' + bucket + ' call used, ' + quotaLeft(bucket) + ' left this month.)', 'ok');
      await logFetch(url, detected.platform, tool, bucket);
    } catch (e) {
      if (tool === 'to_song') showConvertProgress(0, 'Conversion failed — try again with a different link.');
      setStatus('Could not fetch this video: ' + escapeHtml(e.message || e), 'err');
    } finally {
      el.fetchBtn.disabled = false;
      el.fetchBtn.textContent = fetchBtnLabel(currentTool);
      if (el.convertBtn) el.convertBtn.disabled = false;
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
    // No downloadable format (e.g. Copy Bio) means nothing to download.
    if (el.downloadBtn) el.downloadBtn.disabled = !r.formats.length;
    const mediaBox = el.previewVideo.parentElement; // .preview-media
    if (mediaBox) mediaBox.style.display = ''; // restore after an earlier failed preview hid it
    // If the still thumbnail cannot be shown either, hide the (otherwise
    // empty black) media box and say so plainly instead — the Download
    // button still works.
    const showThumbFallback = () => {
      el.previewImage.style.display = 'none';
      if (mediaBox) mediaBox.style.display = 'none';
      el.downloadNote.textContent += ' Preview could not be shown in this browser — the Download button below still works.';
    };
    const isImage = first && /^(jpg|jpeg|png|webp|gif)$/i.test(first.ext || '');
    if (isImage) {
      // DP Download: the "video" is a picture — show the image itself,
      // not a video player trying to play a JPG.
      el.previewVideo.style.display = 'none';
      el.previewImage.style.display = 'block';
      el.previewImage.src = first.url;
      el.previewImage.onerror = showThumbFallback;
    } else if (first) {
      el.previewVideo.style.display = 'block';
      el.previewImage.style.display = 'none';
      el.previewVideo.poster = r.thumbnail || '';
      el.previewVideo.src = first.url;
      el.previewVideo.load();
      // Instagram's CDN video sometimes will not play inline in a
      // browser even though the same file downloads fine. If the
      // player errors, fall back to the still thumbnail instead of a
      // black box — the Download button still saves the real file.
      el.previewVideo.onerror = () => {
        if (r.thumbnail) {
          el.previewVideo.style.display = 'none';
          el.previewImage.style.display = 'block';
          el.previewImage.src = r.thumbnail;
          el.previewImage.onerror = showThumbFallback;
        } else showThumbFallback();
      };
    } else if (r.thumbnail) {
      el.previewVideo.style.display = 'none';
      el.previewImage.style.display = 'block';
      el.previewImage.src = r.thumbnail;
      el.previewImage.onerror = showThumbFallback;
    }
    el.downloadNote.textContent = r.isAudio
      ? (r.convertedLocally
        ? 'Audio extracted in your browser from the video — no server was used, the file never left your device. Press Download to save it.'
        : (r.wavFallback ? 'WAV is not returned by the API — saved as MP3 instead. ' : '') +
          'Audio download: this saves the audio stream the API returns (.mp3 / .m4a). If the API returns video-only, pick the audio format above.')
      : 'Download saves the file straight to your Downloads folder (PC) or Files/Downloads (phone).';

    // Quality pills — IG usually returns a single 720p HD URL; YT/FB return several.
    const order = { '1080p': 1, '720p': 2, '480p': 3, '360p': 4, '240p': 5 };
    const sorted = r.formats.slice().sort((a, b) => {
      const qa = Object.keys(order).find(k => (a.quality || '').includes(k));
      const qb = Object.keys(order).find(k => (b.quality || '').includes(k));
      return (qa ? order[qa] : 9) - (qb ? order[qb] : 9);
    });
    // "Original" = the best file the API returns (the video as uploaded).
    // The top pill is relabelled Original (its real resolution stays as
    // the small label), so picking Original downloads the best file and
    // the download always follows the pill you picked. Not used for
    // pictures (DP) or converted audio — those are not video qualities.
    if (sorted.length && !isImage && !r.isAudio) {
      const best = sorted[0];
      sorted[0] = { quality: 'Original', label: (best.quality || '') + (best.ext ? ' · ' + best.ext.toUpperCase() : ''), ext: best.ext, url: best.url };
    }
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
    // Converted audio is already a local blob — save it straight away,
    // no network fetch needed.
    if (f.url && f.url.indexOf('blob:') === 0) {
      const a = document.createElement('a');
      a.href = f.url; a.download = filename; a.click();
      el.progressBar.style.width = '100%';
      el.progressText.textContent = 'Saved: ' + filename;
      mirrorDownloadProgress();
      setStatus('Download started ✓ — check your Downloads folder.', 'ok');
      return;
    }
    // Try a blob download first so the file lands in Downloads even when
    // the CDN blocks a plain anchor download (cross-origin). One retry:
    // a failed first attempt is often a transient network/DNS blip.
    let res = null, lastErr = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        res = await fetch(f.url);
        if (!res.ok) throw new Error('media HTTP ' + res.status);
        break;
      } catch (e) {
        lastErr = e; res = null;
        if (attempt === 0) await new Promise(r => setTimeout(r, 1500));
      }
    }
    try {
      if (!res) throw lastErr || new Error('network error');
      const total = Number(res.headers.get('content-length') || 0);
      const reader = res.body.getReader();
      const chunks = []; let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value); received += value.length;
        if (total) { el.progressBar.style.width = Math.round(received / total * 100) + '%'; el.progressText.textContent = 'Downloading… ' + fmtSize(received) + (total ? ' / ' + fmtSize(total) : ''); mirrorDownloadProgress(); }
      }
      const mime = f.ext === 'mp3' ? 'audio/mpeg' : /^(jpg|jpeg)$/i.test(f.ext) ? 'image/jpeg' : f.ext === 'png' ? 'image/png' : 'video/mp4';
      const blob = new Blob(chunks, { type: mime });
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
      // Say plainly that the direct download failed and why, instead of
      // implying it worked.
      const a = document.createElement('a');
      a.href = f.url; a.download = filename; a.target = '_blank'; a.rel = 'noopener'; a.click();
      el.progressText.textContent = 'Direct download failed — opened the video link instead. If it does not load, try again on another network or Wi-Fi.';
      setStatus('The file could not be downloaded directly — this browser could not reach the video server. A direct link was opened instead; if it also fails to load, try again on another network or Wi-Fi.', 'err');
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
  /* Fetch button label per section — the button says what it will fetch. */
  const FETCH_BTN_LABEL = {
    ig_reel: '▶ Get Reel', ig_story: '▶ Get Story', ig_dp: '▶ Get DP',
    ig_caption: '▶ Get Caption', ig_bio: '▶ Get Bio', yt_short: '▶ Get Short',
    yt_full: '▶ Get Video', fb_video: '▶ Get Video', to_song: '▶ Get Audio',
    dashboard: '▶ Get Video'
  };
  const fetchBtnLabel = (t) => FETCH_BTN_LABEL[t] || '▶ Get Video';

  const TOOL_TEXT = {
    dashboard: ['Dash<span>board</span>', 'Pick a tool below — Instagram, YouTube, Facebook or Video to Audio — then paste a link there.'],
    ig_reel: ['Instagram <span>Reel</span>', 'Paste an Instagram Reel link — preview it, then download in HD.'],
    ig_story: ['Instagram <span>Story</span>', 'Paste a Story link (instagram.com/stories/…). Stories expire — fetch while it is still live. Uses the all-in-one API.'],
    ig_dp: ['Instagram <span>DP</span>', 'Paste a profile link, or type a username or account ID — downloads the real profile picture. Uses Scrappa (free, no card needed).'],
    ig_caption: ['Copy Reel <span>Caption</span>', 'Fetch a Reel, then copy its caption to the clipboard in one tap.'],
    ig_bio: ['Copy <span>Bio</span>', 'Paste a profile link, or type a username or account ID — fetches the real bio from Instagram. Uses Scrappa (free, no card needed).'],
    fb_video: ['Facebook <span>Video</span>', 'Paste a Facebook video link — preview it, then download. Uses the all-in-one API.'],
    yt_short: ['YouTube <span>Short</span>', 'Paste a YouTube Shorts link (youtube.com/shorts/… or youtu.be/…) and download it.'],
    yt_full: ['YouTube <span>Video</span>', 'Paste a full YouTube video link (youtube.com/watch?v=…) and pick a quality.'],
    to_song: ['Video to <span>Song</span>', 'Paste an Instagram Reel link — the audio is extracted in your browser and saved as .mp3 / .m4a / .wav (real WAV, no fallback). YouTube and Facebook audio still need their API subscription.']
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
    // The "Download a Video" fetch card is removed from the Dashboard —
    // the dashboard is Quick Actions + history + stats only. The card
    // (URL box, Fetch button, DP/Bio helper) shows on every tool page.
    if (el.fetchCard) el.fetchCard.style.display = page === 'dashboard' ? 'none' : '';
    if (el.qualityRow) el.qualityRow.style.display = 'none'; // renderPreview shows it again for YT/FB
    if (page !== 'converter') hideConvertProgress();
    if (el.converterCard) el.converterCard.style.display = page === 'converter' ? '' : 'none';
    if (page === 'dashboard') renderStats();
    const t = TOOL_TEXT[tool] || TOOL_TEXT.dashboard;
    el.pageTitle.innerHTML = t[0]; el.pageSub.textContent = t[1];
    if (el.fetchBtn) el.fetchBtn.textContent = fetchBtnLabel(tool);
    el.fetchTitle.textContent = tool === 'dashboard' ? 'Download a Video'
      : tool === 'ig_dp' ? 'Profile link or username'
      : tool === 'ig_bio' ? 'Profile link or username'
      : tool === 'to_song' ? 'Paste video URL to extract the song'
      : 'Paste video URL';
    el.fetchHint.textContent = t[1];
    if (el.urlInput) el.urlInput.placeholder = (tool === 'ig_dp' || tool === 'ig_bio')
      ? 'Profile link or username — e.g. instagram.com/mr.kaifu_4u/ or mr.kaifu_4u'
      : 'https://www.instagram.com/reel/…  or  https://www.youtube.com/shorts/…  or  https://www.facebook.com/…/videos/…';
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
    if (el.audioFileName) el.audioFileName.textContent = f ? 'Chosen: ' + f.name + ' — press Convert to Audio to extract its song. (If you paste a URL above, the URL is used instead.)' : 'No file chosen.';
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
  document.querySelectorAll('[data-sample]').forEach(b => b.addEventListener('click', () => {
    el.urlInput.value = b.dataset.sample; el.urlInput.focus();
    const t = detectSwitchTarget(b.dataset.sample); // the sample IS a reel — open its section
    if (t && t !== currentTool) setTool(t);
  }));
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
    // One helper for all three input forms: a full profile link, a bare
    // username ("mr.kaifu_4u"), "@mr.kaifu_4u", or a numeric account ID.
    // Never build instagram.com/https://… — the shared normaliser
    // (profileInputOf) strips any domain first.
    const ref = profileInputOf(el.usernameInput.value);
    if (!ref) { setStatus('Enter a valid Instagram username or profile link.', 'err'); return; }
    if (ref.username) el.urlInput.value = 'https://www.instagram.com/' + ref.username + '/';
    else el.urlInput.value = ''; // numeric account ID — handleFetch reads the helper field
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
  // Only switch on a COMPLETE link: while a URL is still being typed,
  // "instagram.com/" on its own looks like a profile link, so switching
  // then would lock the tool to DP Download and send a reel to the wrong
  // API. A half-typed path keyword ("/re", "/reel" with no ID yet) also
  // waits. The tool may re-switch when the detected type changes, so a
  // corrected paste is never stuck on the first guess.
  function detectSwitchTarget(value) {
    const raw = (value || '').trim().toLowerCase();
    const u = raw.split(/[?#]/)[0];
    if (/instagram\.com/.test(u)) {
      if (/\/stories?\/[^/]+/.test(u)) return 'ig_story';
      if (/\/(reel|reels|p|tv)\/[^/]+/.test(u)) return 'ig_reel';
      const m = u.match(/instagram\.com\/([a-z0-9._]+)\/?$/);
      if (m && !/^(r|re|ree|reel|reels|p|t|tv|s|st|sto|stor|stori|stories)$/.test(m[1])) return 'ig_dp';
      return null;
    }
    if (/facebook\.com|fb\.watch/.test(u)) {
      if (/\/(videos|reel)\/[^/]+/.test(u) || /fb\.watch\/[^/]+/.test(u) || /facebook\.com\/watch/.test(raw)) return 'fb_video';
      return null;
    }
    if (/youtube\.com\/shorts\/[^/]+/.test(u) || /youtu\.be\/[^/]+/.test(u)) return 'yt_short';
    if (/youtube\.com\/watch/.test(raw) || /youtube\.com\/embed\/[^/]+/.test(u) || /music\.youtube\.com\/watch/.test(raw)) return 'yt_full';
    return null;
  }
  // NOTE: the URL box no longer auto-switches the tool while typing or
  // pasting. Each section now validates strictly instead: a Facebook link
  // pasted in the Reel section shows "This URL is invalid for Reel
  // Download…" rather than silently jumping to another section. (The
  // old auto-switch is what used to lock a half-typed reel URL to DP
  // Download; the strict check replaces it.)

  applyAppSettings();
  renderQuota();
  renderHistory();
  renderSettings();
  // Run the dashboard page setup on load too — setTool() is what hides
  // the "Download a Video" fetch card on the dashboard, and without this
  // call it only ran after a nav click, so a fresh load still showed it.
  setTool('dashboard');
})();
