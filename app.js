/* ==========================================================================
   Video Downloader — app.js
   Flow: paste URL -> Fetch (1 API call) -> preview on screen ->
         pick quality -> Download straight to PC / phone.
   A built-in RapidAPI key (config.js, owner's choice, public repo) is
   used when no key is saved in Settings; a saved key overrides it.
   Keys typed in Settings live ONLY in localStorage (vd_settings).
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
    appsScriptInput: $('appsScriptInput'), settingsMsg: $('settingsMsg')
  };

  let currentTool = 'dashboard';
  let currentResult = null;   // normalised fetch result
  let selectedQuality = null; // chosen format object

  /* ---------- settings (localStorage only) ---------- */
  function loadSettings() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE.settings) || '{}');
      return {
        rapidapiKey: s.rapidapiKey || DEFAULT_RAPIDAPI_KEY || '',
        appsScriptUrl: s.appsScriptUrl || '',
        limits: Object.assign({}, DEFAULT_LIMITS, s.limits || {})
      };
    } catch { return { rapidapiKey: DEFAULT_RAPIDAPI_KEY || '', appsScriptUrl: '', limits: Object.assign({}, DEFAULT_LIMITS) }; }
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
  }

  /* ---------- history (localStorage) ---------- */
  function loadHistory() {
    try { return JSON.parse(localStorage.getItem(STORE.history) || '[]'); } catch { return []; }
  }
  function renderHistory() {
    const h = loadHistory();
    if (!h.length) { el.historyList.innerHTML = '<p class="empty">No downloads yet — paste a link above and press Fetch.</p>'; return; }
    el.historyList.innerHTML = h.slice(0, 20).map(item =>
      '<div class="history-item"><div><div class="h-url">' + escapeHtml(item.video_url) + '</div>' +
      '<div class="h-meta">' + escapeHtml(item.date + ' ' + item.time) + ' · ' + escapeHtml(item.device) +
      ' · ' + escapeHtml(item.city || 'unknown location') + ' · Quality: ' + escapeHtml(item.quality || '—') + '</div></div>' +
      '<span class="h-badge">' + escapeHtml(item.platform) + ' · ' + escapeHtml(item.tool) + '</span></div>'
    ).join('');
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
      setStatus('Saved to local history. Tip: add your Apps Script URL in Settings to also log it to Google Sheets.', 'info');
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
      setStatus('Saved locally, but the Sheet log failed — check the Apps Script URL in Settings.', 'err');
    }
  }

  /* ---------- status ---------- */
  function setStatus(msg, type) {
    el.status.className = 'status show ' + (type || 'info');
    el.status.innerHTML = msg;
  }
  function clearStatus() { el.status.className = 'status'; el.status.innerHTML = ''; }

  /* ---------- API calls ---------- */
  function needKey() {
    if (!settings.rapidapiKey) {
      setStatus('Add your RapidAPI key in Settings first — it is stored only in this browser. (Or press “Demo preview” to see the layout without a key.)', 'err');
      document.getElementById('settingsCard').scrollIntoView({ behavior: 'smooth' });
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
    if (quotaLeft(bucket) <= 0) {
      setStatus('Monthly limit reached for ' + bucket + ' (' + settings.limits[bucket] + '/month). It resets ' + nextResetDate() + ' — or raise the limit in Settings if you upgraded your plan.', 'err');
      return;
    }
    if (!needKey()) return;

    el.fetchBtn.disabled = true;
    el.fetchBtn.textContent = 'Fetching…';
    setStatus('<span class="spinner"></span>Checking the video… (uses 1 API call)', 'info');
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
        result.isAudio = true;
      }

      bumpQuota(bucket); // count AFTER a successful fetch
      currentResult = Object.assign(result, { sourceUrl: url, platform: detected.platform, tool, bucket });
      renderPreview(result);
      setStatus('Video found ✓ — pick a quality, then Download. (1 ' + bucket + ' call used, ' + quotaLeft(bucket) + ' left this month.)', 'ok');
      await logFetch(url, detected.platform, tool, bucket);
    } catch (e) {
      setStatus('Could not fetch this video: ' + escapeHtml(e.message || e), 'err');
    } finally {
      el.fetchBtn.disabled = false;
      el.fetchBtn.textContent = 'Fetch video';
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
      ? 'Audio download: this saves the audio stream the API returns (.mp3 / .m4a). The browser cannot transcode video locally — if the API returns video-only, pick the audio format above.'
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
      b.onclick = () => {
        selectedQuality = f;
        el.qualityList.querySelectorAll('.qpill').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        if (!r.isAudio) { el.previewVideo.src = f.url; el.previewVideo.load(); }
      };
      el.qualityList.appendChild(b);
      if (i === 0) selectedQuality = f;
    });
    if (!r.formats.length) el.qualityList.innerHTML = '<p class="empty">No quality options returned.</p>';
    el.previewCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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
        if (total) { el.progressBar.style.width = Math.round(received / total * 100) + '%'; el.progressText.textContent = 'Downloading… ' + fmtSize(received) + (total ? ' / ' + fmtSize(total) : ''); }
      }
      const blob = new Blob(chunks, { type: f.ext === 'mp3' ? 'audio/mpeg' : 'video/mp4' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = filename; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      el.progressBar.style.width = '100%';
      el.progressText.textContent = 'Saved: ' + filename;
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
    dashboard: ['Dash<span>board</span>', 'Paste a video link, preview it, pick a quality and download — straight to your PC or phone.'],
    ig_reel: ['Instagram <span>Reel</span>', 'Paste an Instagram Reel link — preview it, then download in HD.'],
    ig_story: ['Instagram <span>Story</span>', 'Paste a Story link (instagram.com/stories/…). Stories expire — fetch while it is still live. Uses the all-in-one API.'],
    ig_dp: ['Instagram <span>DP</span>', 'Enter a username below, or paste a profile link — downloads the full-size profile picture. Uses the all-in-one API.'],
    ig_caption: ['Copy Reel <span>Caption</span>', 'Fetch a Reel, then copy its caption to the clipboard in one tap.'],
    ig_bio: ['Copy <span>Bio</span>', 'Enter a username below — fetches the profile and copies the bio text. Uses the all-in-one API.'],
    fb_video: ['Facebook <span>Video</span>', 'Paste a Facebook video link — preview it, then download. Uses the all-in-one API.'],
    yt_short: ['YouTube <span>Short</span>', 'Paste a YouTube Shorts link (youtube.com/shorts/… or youtu.be/…) and download it.'],
    yt_full: ['YouTube <span>Video</span>', 'Paste a full YouTube video link (youtube.com/watch?v=…) and pick a quality.'],
    to_song: ['Video to <span>Song</span>', 'Paste any video link — the audio-only format is downloaded as .mp3 / .m4a. The browser cannot transcode video locally.']
  };
  function setTool(tool) {
    currentTool = tool;
    document.querySelectorAll('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
    const t = TOOL_TEXT[tool] || TOOL_TEXT.dashboard;
    el.pageTitle.innerHTML = t[0]; el.pageSub.textContent = t[1];
    el.fetchTitle.textContent = tool === 'ig_dp' ? 'Instagram username / profile URL'
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

  /* ---------- settings panel ---------- */
  function renderSettings() {
    el.apiKeyInput.value = settings.rapidapiKey || '';
    el.appsScriptInput.value = settings.appsScriptUrl || '';
    $('limitIg').value = settings.limits.instagram;
    $('limitYt').value = settings.limits.youtube;
    $('limitFb').value = settings.limits.facebook;
    $('limitAll').value = settings.limits.allinone;
  }
  function saveSettingsFromForm() {
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
  $('saveSettingsBtn').addEventListener('click', saveSettingsFromForm);
  $('toggleKeyBtn').addEventListener('click', () => {
    const show = el.apiKeyInput.type === 'password';
    el.apiKeyInput.type = show ? 'text' : 'password';
    $('toggleKeyBtn').textContent = show ? 'Hide key' : 'Show key';
  });
  $('testSheetBtn').addEventListener('click', async () => {
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

  renderQuota();
  renderHistory();
  renderSettings();
})();
