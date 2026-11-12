// Sheet logging test (jsdom): a successful fetch must POST the entry
// to the Apps Script backend — REGRESSION test for the v11 bug where
// downloader_data stayed empty because the admin panel saved the URL
// under vd_admin_backend while the user app only read
// vd_settings.appsScriptUrl (and the user-app settings panel that used
// to set it was removed). Cases: (1) admin URL only — the bug scenario,
// (2) both URLs — vd_settings wins, (3) no URL anywhere — no POST, but
// local history is still saved.
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

async function runCase(name, seed, expectUrl) {
  const dom = new JSDOM(html, { url: 'https://mrkaifu4u.github.io/download_url_project/', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const { document } = window;
  const ctxMock = new Proxy({}, {
    get(t, prop) { if (prop in t) return t[prop]; return (...args) => ctxMock; },
    set(t, prop, v) { t[prop] = v; return true; }
  });
  window.HTMLCanvasElement.prototype.getContext = () => ctxMock;
  window.Element.prototype.scrollIntoView = () => {}; // jsdom lacks it; real browsers have it
  window.HTMLMediaElement.prototype.load = () => {}; // silence jsdom "not implemented" noise
  window.DataTransfer = class {
    constructor() { this._files = []; this._text = ''; }
    get files() { return this._files; }
    get items() { return { add: (f) => this._files.push(f) }; }
    getData() { return this._text; }
    setData(t, v) { this._text = v; }
  };

  const posts = [];
  window.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('/fetch?url=')) {
      return { ok: true, json: async () => ({ ok: true, download_url: 'https://fake-fbcdn/video.mp4', caption: 'test reel', width: 720, height: 1280, thumbnail_url: '' }) };
    }
    if (u.startsWith('https://script.google.com/macros/s/')) {
      posts.push({ url: u, body: JSON.parse((opts && opts.body) || '{}') });
      return { ok: true, json: async () => ({ ok: true, row: 2 }) };
    }
    throw new Error('unexpected fetch: ' + u);
  };

  // Seed localStorage BEFORE the app loads (settings are read at startup).
  Object.entries(seed).forEach(([k, v]) => window.localStorage.setItem(k, v));
  window.eval(configJs);
  window.eval(appJs);

  const $ = (id) => document.getElementById(id);
  document.querySelector('.nav-item[data-tool="ig_reel"]').click();
  $('urlInput').value = 'https://www.instagram.com/reel/DeEvB06NaqX/';
  $('fetchBtn').click();
  const start = Date.now();
  while (Date.now() - start < 15000) {
    await new Promise((r) => setTimeout(r, 200));
    if ($('fetchBtn').disabled === false && ($('status').textContent || '').length > 0) break;
  }
  const status = $('status').textContent || '';
  check(name + ': fetch succeeds', /video is ready/i.test(status), 'status=' + status);
  if (expectUrl) {
    check(name + ': entry POSTed to the Apps Script URL', posts.length === 1 && posts[0].url === expectUrl, JSON.stringify(posts.map((p) => p.url)));
    if (posts.length === 1) {
      const e = posts[0].body;
      check(name + ': posted entry has the right fields',
        e.platform === 'instagram' && e.tool === 'ig_reel' &&
        e.video_url === 'https://www.instagram.com/reel/DeEvB06NaqX/' &&
        e.date === new Date().toLocaleDateString('en-GB') &&
        e.city === 'Location not shared (none)' && !('action' in e),
        JSON.stringify(e));
    }
  } else {
    check(name + ': no Sheet POST without a URL', posts.length === 0, JSON.stringify(posts));
  }
  const hist = JSON.parse(window.localStorage.getItem('vd_history') || '[]');
  check(name + ': local history still saved', hist.length === 1 && hist[0].tool === 'ig_reel', 'rows=' + hist.length);
  window.close();
}

(async () => {
  const ADMIN_URL = 'https://script.google.com/macros/s/ADMIN/exec';
  const MAIN_URL = 'https://script.google.com/macros/s/MAIN/exec';
  await runCase('admin URL only (the bug)', { vd_admin_backend: ADMIN_URL }, ADMIN_URL);
  await runCase('both URLs (vd_settings wins)', { vd_admin_backend: ADMIN_URL, vd_settings: JSON.stringify({ appsScriptUrl: MAIN_URL }) }, MAIN_URL);
  await runCase('no URL anywhere', {}, null);
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
