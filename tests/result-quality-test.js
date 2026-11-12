// Result card + quality dropdown test (jsdom, v12): the Preview card
// is gone — after a fetch the Download result card shows the title, a
// working quality <select> (best file first, labelled Original) and the
// Download button. Picking a quality must change which file downloads.
// Cases: (1) IG reel — one format, one "Original" option; (2) YouTube
// multi-format — Original + 720p + 480p, and downloading after picking
// 480p fetches the 480p file; (3) DP — picture shown, no quality row;
// (4) Bio — no download, bio text shown, no quality row.
const fs = require('fs');
const { JSDOM } = require('jsdom');

process.on('unhandledRejection', () => {});

const dir = '/home/hatch/workspace/video-downloader';
const html = fs.readFileSync(dir + '/index.html', 'utf8');
const configJs = fs.readFileSync(dir + '/config.js', 'utf8');
const appJs = fs.readFileSync(dir + '/app.js', 'utf8');

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

function makeDom() {
  const dom = new JSDOM(html, { url: 'https://mrkaifu4u.github.io/download_url_project/', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const { document } = window;
  const ctxMock = new Proxy({}, {
    get(t, prop) { if (prop in t) return t[prop]; return (...args) => ctxMock; },
    set(t, prop, v) { t[prop] = v; return true; }
  });
  window.HTMLCanvasElement.prototype.getContext = () => ctxMock;
  window.Element.prototype.scrollIntoView = () => {};
  window.HTMLMediaElement.prototype.load = () => {};
  window.DataTransfer = class {
    constructor() { this._files = []; this._text = ''; }
    get files() { return this._files; }
    get items() { return { add: (f) => this._files.push(f) }; }
    getData() { return this._text; }
    setData(t, v) { this._text = v; }
  };
  // jsdom has no URL.createObjectURL / anchor download — stub them so
  // handleDownload can run to completion.
  window.URL.createObjectURL = () => 'blob:fake';
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () {};
  return { window, document };
}

async function driveFetch(document, tool, url, btnId) {
  const $ = (id) => document.getElementById(id);
  const nav = document.querySelector('.nav-item[data-tool="' + tool + '"]');
  if (nav) nav.click();
  else {
    // Sub-tool reached via its page's tabs (e.g. ig_dp on the Instagram page).
    document.querySelector('.nav-item[data-tool="ig_reel"]').click();
    document.querySelector('.tab[data-tab-tool="' + tool + '"]').click();
  }
  $('urlInput').value = url;
  $(btnId || 'fetchBtn').click();
  const start = Date.now();
  while (Date.now() - start < 15000) {
    await new Promise((r) => setTimeout(r, 200));
    if ($('fetchBtn').disabled === false && ($('status').textContent || '').length > 0) break;
  }
  return $('status').textContent || '';
}

(async () => {
  /* ---------- 1. IG reel: one format, one Original option ---------- */
  {
    const { window, document } = makeDom();
    window.fetch = async (url) => {
      if (String(url).includes('/fetch?url=')) {
        return { ok: true, json: async () => ({ ok: true, download_url: 'https://fake-fbcdn/reel.mp4', caption: 'My test reel caption', width: 720, height: 1280, thumbnail_url: '' }) };
      }
      throw new Error('unexpected fetch: ' + url);
    };
    window.eval(configJs);
    window.eval(appJs);
    const $ = (id) => document.getElementById(id);
    const status = await driveFetch(document, 'ig_reel', 'https://www.instagram.com/reel/DeEvB06NaqX/');
    check('IG: fetch succeeds', /video is ready/i.test(status), status);
    check('IG: no Preview card in the page', !$('previewCard') && !document.querySelector('video'));
    check('IG: result card shows', $('resultCard').classList.contains('show'));
    check('IG: title shown', /My test reel caption/.test($('resultTitle').textContent), $('resultTitle').textContent);
    check('IG: caption shown', $('resultCaption').style.display !== 'none' && /My test reel caption/.test($('resultCaption').textContent));
    const opts = Array.from($('qualitySelect').options).map((o) => o.textContent);
    check('IG: quality dropdown has one Original option', opts.length === 1 && /^Original — 720p HD · MP4$/.test(opts[0]), JSON.stringify(opts));
    check('IG: quality row visible', $('qualityRow').style.display !== 'none');
    check('IG: Download enabled', $('downloadBtn').disabled === false);
    window.close();
  }

  /* ---------- 2. YouTube multi-format: picking a quality changes the download ---------- */
  {
    const { window, document } = makeDom();
    const fetchedUrls = [];
    window.fetch = async (url, opts) => {
      const u = String(url);
      if (u.includes('youtube-downloader')) return { ok: false, status: 404, json: async () => ({}) };
      if (u.includes('/extract')) {
        return { ok: true, json: async () => ({ title: 'YT test', formats: [
          { quality: '480p', url: 'https://fake-cdn/yt-480.mp4', ext: 'mp4' },
          { quality: '1080p', url: 'https://fake-cdn/yt-1080.mp4', ext: 'mp4' },
          { quality: '720p', url: 'https://fake-cdn/yt-720.mp4', ext: 'mp4' }
        ] }) };
      }
      if (u.startsWith('https://fake-cdn/')) {
        fetchedUrls.push(u);
        return { ok: true, headers: { get: () => '4' }, body: null, arrayBuffer: async () => new Uint8Array([0, 0, 0, 0]).buffer };
      }
      throw new Error('unexpected fetch: ' + u);
    };
    window.eval(configJs);
    window.eval(appJs);
    const $ = (id) => document.getElementById(id);
    const status = await driveFetch(document, 'yt_short', 'https://www.youtube.com/shorts/abc123');
    check('YT: fetch succeeds', /video is ready/i.test(status), status);
    const opts = Array.from($('qualitySelect').options).map((o) => o.textContent);
    check('YT: dropdown lists Original first, then 720p, then 480p',
      opts.length === 3 && /^Original — 1080p · MP4$/.test(opts[0]) && /^720p/.test(opts[1]) && /^480p/.test(opts[2]),
      JSON.stringify(opts));
    // Pick 480p (index 2) and download — the blob fetch must ask for the 480p file.
    $('qualitySelect').value = '2';
    $('qualitySelect').dispatchEvent(new window.Event('change', { bubbles: true }));
    $('downloadBtn').click();
    const start = Date.now();
    while (Date.now() - start < 10000 && fetchedUrls.length === 0) await new Promise((r) => setTimeout(r, 200));
    check('YT: downloading after picking 480p fetches the 480p file', fetchedUrls.length === 1 && fetchedUrls[0] === 'https://fake-cdn/yt-480.mp4', JSON.stringify(fetchedUrls));
    window.close();
  }

  /* ---------- 3. DP: picture shown, no quality row ---------- */
  {
    const { window, document } = makeDom();
    window.fetch = async (url) => {
      if (String(url).includes('scrappa.co')) {
        return { ok: true, json: async () => ({ user: { username: 'mr.kaifu_4u', full_name: 'Kaif', profile_pic_url: 'https://fake-cdn/dp.jpg', profile_pic_url_hd: null, biography: '', follower_count: 10, following_count: 5, media_count: 13 } }) };
      }
      throw new Error('unexpected fetch: ' + url);
    };
    window.eval(configJs);
    window.eval(appJs);
    const $ = (id) => document.getElementById(id);
    const status = await driveFetch(document, 'ig_dp', 'https://www.instagram.com/mr.kaifu_4u/');
    check('DP: fetch succeeds', /video is ready|ready/i.test(status), status);
    check('DP: picture shown in result card', $('resultImage').style.display !== 'none' && $('resultImage').src === 'https://fake-cdn/dp.jpg', $('resultImage').src);
    check('DP: quality row hidden (no video qualities)', $('qualityRow').style.display === 'none');
    check('DP: Download enabled', $('downloadBtn').disabled === false);
    window.close();
  }

  /* ---------- 4. Bio: no download, bio text shown ---------- */
  {
    const { window, document } = makeDom();
    window.fetch = async (url) => {
      if (String(url).includes('scrappa.co')) {
        return { ok: true, json: async () => ({ user: { username: 'mr.kaifu_4u', full_name: 'Kaif', profile_pic_url: 'https://fake-cdn/dp.jpg', biography: 'AI/ML Engineer — building things.', follower_count: 10, following_count: 5, media_count: 13 } }) };
      }
      throw new Error('unexpected fetch: ' + url);
    };
    window.eval(configJs);
    window.eval(appJs);
    const $ = (id) => document.getElementById(id);
    const status = await driveFetch(document, 'ig_bio', 'https://www.instagram.com/mr.kaifu_4u/');
    check('Bio: fetch succeeds', /ready/i.test(status), status);
    check('Bio: bio text shown', $('resultCaption').style.display !== 'none' && /AI\/ML Engineer/.test($('resultCaption').textContent), $('resultCaption').textContent);
    check('Bio: Download disabled (nothing to download)', $('downloadBtn').disabled === true);
    check('Bio: quality row hidden', $('qualityRow').style.display === 'none');
    window.close();
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
