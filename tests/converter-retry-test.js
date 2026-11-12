// Converter retry test (jsdom): the video file fetch must survive a
// flaky file server — two failed byte fetches, then success — without
// re-asking the API each time. The ffmpeg engine cannot load in jsdom,
// so the flow is expected to fail AFTER the bytes arrive; the test
// asserts the bytes got through (fetch counts + error text).
const fs = require('fs');
const { JSDOM } = require('jsdom');

// The ffmpeg engine import fails in jsdom (bare specifier, no import
// map) and its promise rejects while the fetch retries are still
// running — the app does handle that rejection later (await
// enginePromise), but node would crash on the interim unhandled
// rejection, so swallow it here.
process.on('unhandledRejection', () => {});

const dir = '/home/hatch/workspace/video-downloader';
const html = fs.readFileSync(dir + '/index.html', 'utf8');
const configJs = fs.readFileSync(dir + '/config.js', 'utf8');
const appJs = fs.readFileSync(dir + '/app.js', 'utf8');

const dom = new JSDOM(html, { url: 'https://mrkaifu4u.github.io/download_url_project/', runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;
const { document } = window;

const ctxMock = new Proxy({}, {
  get(t, prop) { if (prop in t) return t[prop]; return (...args) => ctxMock; },
  set(t, prop, v) { t[prop] = v; return true; }
});
window.HTMLCanvasElement.prototype.getContext = () => ctxMock;
window.DataTransfer = class {
  constructor() { this._files = []; this._text = ''; }
  get files() { return this._files; }
  get items() { return { add: (f) => this._files.push(f) }; }
  getData() { return this._text; }
  setData(t, v) { this._text = v; }
};
const audioFileInput = document.getElementById('audioFileInput');
let chosenFiles = [];
Object.defineProperty(audioFileInput, 'files', {
  get() { return chosenFiles; },
  set(v) { chosenFiles = Array.from(v || []); },
  configurable: true
});

let apiCalls = 0, videoCalls = 0;
window.fetch = async (url) => {
  const u = String(url);
  if (u.includes('/fetch?url=')) {
    apiCalls++;
    return { ok: true, json: async () => ({ ok: true, download_url: 'https://fake-fbcdn/video.mp4', caption: 'test reel', width: 720, height: 1280, thumbnail_url: '' }) };
  }
  if (u === 'https://fake-fbcdn/video.mp4') {
    videoCalls++;
    if (videoCalls <= 2) throw new Error('socket hang up');
    return {
      ok: true,
      headers: { get: (n) => (String(n).toLowerCase() === 'content-length' ? '4' : null) },
      body: null,
      arrayBuffer: async () => new Uint8Array([0, 0, 0, 0]).buffer
    };
  }
  throw new Error('unexpected fetch: ' + u);
};

window.eval(configJs);
window.eval(appJs);

const $ = (id) => document.getElementById(id);
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

(async () => {
  document.querySelector('.nav-item[data-tool="to_song"]').click();
  $('urlInput').value = 'https://www.instagram.com/reel/DeEvB06NaqX/';
  $('convertBtn').click();
  // Wait for the flow to settle: back-offs are 2s + 4s, then ffmpeg fails fast in jsdom.
  const start = Date.now();
  while (Date.now() - start < 30000) {
    await new Promise((r) => setTimeout(r, 300));
    const st = $('status').textContent || '';
    if (st && ($('convertBtn').disabled === false)) break;
  }
  const status = $('status').textContent || '';
  check('API asked exactly once (retries reuse the video URL)', apiCalls === 1, 'apiCalls=' + apiCalls);
  check('video file fetched 3 times (2 failures + success)', videoCalls === 3, 'videoCalls=' + videoCalls);
  check('bytes got through: error is NOT the fetch failure', !status.includes("couldn't get this video"), 'status=' + status);
  check('flow reached the conversion stage', /convert/i.test(status), 'status=' + status);
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
