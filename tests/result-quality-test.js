// Per-tool result controls test (jsdom, v13): each feature shows ONLY
// its own buttons — video downloads get the quality dropdown + their
// own Download button; copy tools get text + Copy only; DP gets the
// picture + Download DP only. The quality dropdown lists only real
// formats, best first as Original (2160p/4K and 1440p/2K sort above
// 1080p), and picking a quality changes which file downloads.
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
const vis = (el) => el && el.style.display !== 'none';

function makeDom(fetchMock) {
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
  window.URL.createObjectURL = () => 'blob:fake';
  window.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function () {};
  window.fetch = fetchMock;
  window.eval(configJs);
  window.eval(appJs);
  return { window, document };
}

async function driveFetch(document, tool, url) {
  const $ = (id) => document.getElementById(id);
  const nav = document.querySelector('.nav-item[data-tool="' + tool + '"]');
  if (nav) nav.click();
  else {
    document.querySelector('.nav-item[data-tool="ig_reel"]').click();
    document.querySelector('.tab[data-tab-tool="' + tool + '"]').click();
  }
  $('urlInput').value = url;
  $('fetchBtn').click();
  const start = Date.now();
  while (Date.now() - start < 15000) {
    await new Promise((r) => setTimeout(r, 200));
    if ($('fetchBtn').disabled === false && ($('status').textContent || '').length > 0) break;
  }
  return $('status').textContent || '';
}

const igMock = async (url) => {
  if (String(url).includes('/fetch?url=')) {
    return { ok: true, json: async () => ({ ok: true, download_url: 'https://fake-fbcdn/reel.mp4', caption: 'My test reel caption', width: 720, height: 1280, thumbnail_url: '' }) };
  }
  throw new Error('unexpected fetch: ' + url);
};
const multiMock = (fetchedUrls) => async (url) => {
  const u = String(url);
  if (u.includes('youtube-downloader')) return { ok: false, status: 404, json: async () => ({}) };
  if (u.includes('/extract')) {
    return { ok: true, json: async () => ({ title: 'Multi test', formats: [
      { quality: '480p', url: 'https://fake-cdn/v-480.mp4', ext: 'mp4' },
      { quality: '2160p', url: 'https://fake-cdn/v-2160.mp4', ext: 'mp4' },
      { quality: '720p', url: 'https://fake-cdn/v-720.mp4', ext: 'mp4' }
    ] }) };
  }
  if (u.startsWith('https://fake-cdn/')) {
    if (fetchedUrls) fetchedUrls.push(u);
    return { ok: true, headers: { get: () => '4' }, body: null, arrayBuffer: async () => new Uint8Array([0, 0, 0, 0]).buffer };
  }
  throw new Error('unexpected fetch: ' + u);
};
const profileMock = (bio) => async (url) => {
  if (String(url).includes('scrappa.co')) {
    return { ok: true, json: async () => ({ user: { username: 'mr.kaifu_4u', full_name: 'Kaif', profile_pic_url: 'https://fake-cdn/dp.jpg', profile_pic_url_hd: null, biography: bio, follower_count: 10, following_count: 5, media_count: 13 } }) };
  }
  throw new Error('unexpected fetch: ' + url);
};

(async () => {
  /* ---------- 1. Reel: quality + Download Reel, no caption/copy ---------- */
  {
    const { window, document } = makeDom(igMock);
    const $ = (id) => document.getElementById(id);
    const status = await driveFetch(document, 'ig_reel', 'https://www.instagram.com/reel/DeEvB06NaqX/');
    check('Reel: fetch succeeds', /video is ready/i.test(status), status);
    check('Reel: no Preview card, no video element', !$('previewCard') && !document.querySelector('video'));
    check('Reel: Download labelled "Download Reel"', $('downloadBtn').textContent === '⬇ Download Reel', $('downloadBtn').textContent);
    check('Reel: quality dropdown shows one Original option',
      vis($('qualityRow')) && $('qualitySelect').options.length === 1 && /^Original — 720p HD · MP4$/.test($('qualitySelect').options[0].textContent),
      JSON.stringify(Array.from($('qualitySelect').options).map((o) => o.textContent)));
    check('Reel: caption box hidden (title line is enough)', !vis($('resultCaption')));
    check('Reel: copy button hidden', !vis($('copyCaptionBtn')));
    check('Reel: no Copy Video Link button anywhere', !$('copyLinkBtn'));
    window.close();
  }

  /* ---------- 2. Story: quality + Download Story ---------- */
  {
    const { window, document } = makeDom(multiMock());
    const $ = (id) => document.getElementById(id);
    const status = await driveFetch(document, 'ig_story', 'https://www.instagram.com/stories/someone/123/');
    check('Story: fetch succeeds', /video is ready/i.test(status), status);
    check('Story: Download labelled "Download Story"', $('downloadBtn').textContent === '⬇ Download Story', $('downloadBtn').textContent);
    check('Story: quality dropdown shown', vis($('qualityRow')) && $('qualitySelect').options.length === 3);
    check('Story: copy button hidden', !vis($('copyCaptionBtn')));
    window.close();
  }

  /* ---------- 3. DP: picture + Download DP only ---------- */
  {
    const { window, document } = makeDom(profileMock('AI/ML Engineer — building things.'));
    const $ = (id) => document.getElementById(id);
    const status = await driveFetch(document, 'ig_dp', 'https://www.instagram.com/mr.kaifu_4u/');
    check('DP: fetch succeeds', /ready/i.test(status), status);
    check('DP: picture shown', vis($('resultImage')) && $('resultImage').src === 'https://fake-cdn/dp.jpg', $('resultImage').src);
    check('DP: Download labelled "Download DP"', $('downloadBtn').textContent === '⬇ Download DP', $('downloadBtn').textContent);
    check('DP: bio/caption text hidden', !vis($('resultCaption')));
    check('DP: quality row hidden', !vis($('qualityRow')));
    check('DP: copy button hidden', !vis($('copyCaptionBtn')));
    window.close();
  }

  /* ---------- 4. Copy Caption: text + Copy Caption only ---------- */
  {
    const { window, document } = makeDom(igMock);
    const $ = (id) => document.getElementById(id);
    const status = await driveFetch(document, 'ig_caption', 'https://www.instagram.com/reel/DeEvB06NaqX/');
    check('Caption: fetch succeeds', /ready/i.test(status), status);
    check('Caption: caption text shown', vis($('resultCaption')) && /My test reel caption/.test($('resultCaption').textContent), $('resultCaption').textContent);
    check('Caption: Copy Caption button shown', vis($('copyCaptionBtn')) && $('copyCaptionBtn').textContent === 'Copy Caption', $('copyCaptionBtn').textContent);
    check('Caption: Download button hidden', !vis($('downloadBtn')));
    check('Caption: quality row hidden (text, not video)', !vis($('qualityRow')));
    window.close();
  }

  /* ---------- 5. Copy Bio: text + Copy Bio only ---------- */
  {
    const { window, document } = makeDom(profileMock('AI/ML Engineer — building things.'));
    const $ = (id) => document.getElementById(id);
    const status = await driveFetch(document, 'ig_bio', 'https://www.instagram.com/mr.kaifu_4u/');
    check('Bio: fetch succeeds', /ready/i.test(status), status);
    check('Bio: bio text shown', vis($('resultCaption')) && /AI\/ML Engineer/.test($('resultCaption').textContent), $('resultCaption').textContent);
    check('Bio: button labelled "Copy Bio"', vis($('copyCaptionBtn')) && $('copyCaptionBtn').textContent === 'Copy Bio', $('copyCaptionBtn').textContent);
    check('Bio: Download button hidden', !vis($('downloadBtn')));
    check('Bio: quality row hidden', !vis($('qualityRow')));
    window.close();
  }

  /* ---------- 6. YouTube Short: 4K sorts first, pick changes the download ---------- */
  {
    const fetchedUrls = [];
    const { window, document } = makeDom(multiMock(fetchedUrls));
    const $ = (id) => document.getElementById(id);
    const status = await driveFetch(document, 'yt_short', 'https://www.youtube.com/shorts/abc123');
    check('YT Short: fetch succeeds', /video is ready/i.test(status), status);
    const opts = Array.from($('qualitySelect').options).map((o) => o.textContent);
    check('YT Short: Original (2160p) first, then 720p, then 480p',
      opts.length === 3 && /^Original — 2160p · MP4$/.test(opts[0]) && /^720p/.test(opts[1]) && /^480p/.test(opts[2]),
      JSON.stringify(opts));
    check('YT Short: Download labelled "Download Short"', $('downloadBtn').textContent === '⬇ Download Short', $('downloadBtn').textContent);
    check('YT Short: copy button hidden', !vis($('copyCaptionBtn')));
    $('qualitySelect').value = '2';
    $('qualitySelect').dispatchEvent(new window.Event('change', { bubbles: true }));
    $('downloadBtn').click();
    const start = Date.now();
    while (Date.now() - start < 10000 && fetchedUrls.length === 0) await new Promise((r) => setTimeout(r, 200));
    check('YT Short: picking 480p downloads the 480p file', fetchedUrls.length === 1 && fetchedUrls[0] === 'https://fake-cdn/v-480.mp4', JSON.stringify(fetchedUrls));
    window.close();
  }

  /* ---------- 7. YouTube Full: Download Video ---------- */
  {
    const { window, document } = makeDom(multiMock());
    const $ = (id) => document.getElementById(id);
    const status = await driveFetch(document, 'yt_full', 'https://www.youtube.com/watch?v=abc123');
    check('YT Full: fetch succeeds', /video is ready/i.test(status), status);
    check('YT Full: Download labelled "Download Video"', $('downloadBtn').textContent === '⬇ Download Video', $('downloadBtn').textContent);
    check('YT Full: quality dropdown shown', vis($('qualityRow')));
    window.close();
  }

  /* ---------- 8. Facebook: Download Video + quality ---------- */
  {
    const { window, document } = makeDom(multiMock());
    const $ = (id) => document.getElementById(id);
    const status = await driveFetch(document, 'fb_video', 'https://www.facebook.com/somepage/videos/123/');
    check('FB: fetch succeeds', /video is ready/i.test(status), status);
    check('FB: Download labelled "Download Video"', $('downloadBtn').textContent === '⬇ Download Video', $('downloadBtn').textContent);
    check('FB: quality dropdown shown', vis($('qualityRow')));
    check('FB: copy button hidden', !vis($('copyCaptionBtn')));
    window.close();
  }

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
