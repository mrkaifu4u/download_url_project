// Resumable download test (jsdom): REGRESSION test for the 2026-11-16
// phone bug — a reel download died mid-file (progress stuck at ~10%)
// because handleDownload retried only the initial connection, never a
// stream that dropped halfway. Cases, all driven through the real UI:
// (1) mid-stream drop, then Range resume — the saved file must be
// byte-complete and a Range header must have been sent; (2) server
// ignores Range (HTTP 200) — download restarts from zero and still
// completes; (3) every attempt dies — the plain fallback message
// appears instead of a fake success.
const fs = require('fs');
const { JSDOM } = require('jsdom');

process.on('unhandledRejection', () => {});

const dir = '/home/hatch/workspace/video-downloader';
const html = fs.readFileSync(dir + '/index.html', 'utf8');
const configJs = fs.readFileSync(dir + '/config.js', 'utf8');
const appJs = fs.readFileSync(dir + '/app.js', 'utf8');

const FILE = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]); // 10-byte fake video
const FBCDN = 'https://fake-fbcdn/video.mp4';

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

// A fake Response whose body streams `bytes` in 2-byte chunks and, when
// dieAfter is true, throws (connection drop) after 2 chunks. `total` is
// the content-length the server reports — for the dying first response
// that is the FULL file size (10), even though only 4 bytes arrive.
function streamResponse(bytes, dieAfter, status, contentRange, total) {
  let i = 0;
  const reader = {
    read: async () => {
      if (dieAfter && i >= 2) throw new Error('simulated connection drop');
      if (i * 2 >= bytes.length) return { done: true, value: undefined };
      const chunk = bytes.slice(i * 2, i * 2 + 2); i++;
      return { done: false, value: chunk };
    }
  };
  return {
    ok: status >= 200 && status < 300, status,
    headers: { get: (k) => {
      k = String(k).toLowerCase();
      if (k === 'content-length') return String(total != null ? total : bytes.length);
      if (k === 'content-range') return contentRange || null;
      return null;
    } },
    body: { getReader: () => reader }
  };
}

async function runCase(name, mode) {
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
  let capturedBlob = null;
  window.URL.createObjectURL = (blob) => { capturedBlob = blob; return 'blob:test'; };
  window.URL.revokeObjectURL = () => {};
  window.open = () => null;

  const mediaCalls = [];
  window.fetch = async (url, opts) => {
    const u = String(url);
    if (u.includes('/fetch?url=')) {
      return { ok: true, json: async () => ({ ok: true, download_url: FBCDN, caption: 'test reel', width: 720, height: 1280, thumbnail_url: '' }) };
    }
    if (u === FBCDN) {
      mediaCalls.push({ headers: (opts && opts.headers) || {} });
      const n = mediaCalls.length;
      if (mode === 'always-fail') return streamResponse(FILE.slice(0, 4), true, 200, null, 10);
      if (n === 1) return streamResponse(FILE.slice(0, 4), true, 200, null, 10); // dies after 4 bytes
      if (mode === 'ignore-range') return streamResponse(FILE, false, 200, null, 10);
      // resume: honour the Range header, HTTP 206
      const range = (opts && opts.headers && opts.headers.Range) || '';
      const start = Number(range.replace('bytes=', '').replace('-', '')) || 0;
      return streamResponse(FILE.slice(start), false, 206, 'bytes ' + start + '-9/10', 10 - start);
    }
    throw new Error('unexpected fetch: ' + u);
  };

  window.eval(configJs);
  window.eval(appJs);
  const $ = (id) => document.getElementById(id);
  document.querySelector('.nav-item[data-tool="ig_reel"]').click();
  $('urlInput').value = 'https://www.instagram.com/reel/DeEvB06NaqX/';
  $('fetchBtn').click();
  let start = Date.now();
  while (Date.now() - start < 15000) {
    await new Promise((r) => setTimeout(r, 200));
    if ($('fetchBtn').disabled === false && ($('status').textContent || '').length > 0) break;
  }
  check(name + ': fetch succeeds', /video is ready/i.test($('status').textContent || ''), 'status=' + $('status').textContent);
  $('downloadBtn').click();
  // Mid-download, during the 2s retry pause after the drop: the ring
  // on the button must be visible at 40% (4 of 10 bytes), the button
  // disabled, and the progress line must say it is picking up.
  await new Promise((r) => setTimeout(r, 1000));
  check(name + ': ring shows on the button during the retry pause', $('downloadRing').hidden === false);
  check(name + ': ring shows the real percentage', $('downloadRingNum').textContent === '40%', 'ring=' + $('downloadRingNum').textContent);
  check(name + ': progress bar shows the real percentage', $('progressBar').style.width === '40%', 'bar=' + $('progressBar').style.width);
  check(name + ': progress line says it is picking up', /picking up from 40%/.test($('progressText').textContent || ''), 'text=' + $('progressText').textContent);
  check(name + ': download button disabled while downloading', $('downloadBtn').disabled === true);
  start = Date.now();
  while (Date.now() - start < 40000) {
    await new Promise((r) => setTimeout(r, 200));
    const pt = $('progressText').textContent || '';
    if (pt.startsWith('Saved:') || pt.includes("couldn't be saved directly")) break;
  }
  check(name + ': ring hides when the download ends', $('downloadRing').hidden === true);
  check(name + ': download button enabled again', $('downloadBtn').disabled === false);
  const progressText = $('progressText').textContent || '';
  const status = $('status').textContent || '';
  if (mode === 'always-fail') {
    check(name + ': fallback message after all attempts fail',
      progressText.includes("couldn't be saved directly") && /couldn't save your file directly/i.test(status),
      'progress=' + progressText + ' status=' + status);
    check(name + ': tried 5 attempts', mediaCalls.length === 5, 'calls=' + mediaCalls.length);
  } else {
    check(name + ': download completes after the drop',
      progressText.startsWith('Saved:') && /download has started/i.test(status),
      'progress=' + progressText + ' status=' + status);
    check(name + ': retried after the drop', mediaCalls.length === 2, 'calls=' + mediaCalls.length);
    if (mode === 'resume') {
      check(name + ': retry sent Range for the missing bytes',
        (mediaCalls[1].headers.Range || '') === 'bytes=4-',
        JSON.stringify(mediaCalls[1].headers));
    }
    if (capturedBlob) {
      // jsdom's Blob lacks arrayBuffer() — read it back via FileReader.
      const bytes = new Uint8Array(await new Promise((resolve, reject) => {
        const fr = new window.FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = reject;
        fr.readAsArrayBuffer(capturedBlob);
      }));
      check(name + ': saved file is byte-complete',
        bytes.length === FILE.length && bytes.every((b, i) => b === FILE[i]),
        'bytes=' + Array.from(bytes).join(','));
    } else {
      check(name + ': saved file is byte-complete', false, 'no blob captured');
    }
  }
  window.close();
}

(async () => {
  await runCase('mid-stream drop + Range resume', 'resume');
  await runCase('server ignores Range (HTTP 200)', 'ignore-range');
  await runCase('every attempt dies', 'always-fail');
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
