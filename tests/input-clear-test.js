// Input-clear test (jsdom): v19 UI fixes — (1) switching tools clears
// the link box (an Instagram link must not sit in the YouTube input),
// (2) every text input has a × button that clears it.
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
window.fetch = async () => { throw new Error('no network in this test'); };

// Seed two history rows so the search filter has something to filter.
const seed = [
  { date: '17/11/2026', time: '01:08:41', device: 'Phone', platform: 'instagram', tool: 'ig_reel', video_url: 'https://www.instagram.com/reel/TravelVlog/', quality: '720p', format: 'MP4', city: 'Amravati', lat: '', lng: '', mapsLink: '' },
  { date: '17/11/2026', time: '01:09:41', device: 'Phone', platform: 'youtube', tool: 'yt_short', video_url: 'https://www.youtube.com/shorts/PythonTutorial/', quality: '720p', format: 'MP4', city: 'Amravati', lat: '', lng: '', mapsLink: '' }
];
window.localStorage.setItem('vd_history', JSON.stringify(seed));
window.eval(configJs);
window.eval(appJs);

const $ = (id) => document.getElementById(id);
const rows = () => document.querySelectorAll('#historyList tbody tr').length;
const typeInto = (el, text) => {
  el.value = text;
  el.dispatchEvent(new window.Event('input', { bubbles: true }));
};

(async () => {
  // Fix 1: an Instagram link must not survive a switch to YouTube.
  document.querySelector('.nav-item[data-tool="ig_reel"]').click();
  typeInto($('urlInput'), 'https://www.instagram.com/reel/DeEvB06NaqX/');
  check('URL box holds the pasted link', $('urlInput').value.includes('DeEvB06NaqX'));
  document.querySelector('.nav-item[data-tool="yt_short"]').click();
  check('switching to YouTube clears the link box', $('urlInput').value === '', 'value=' + $('urlInput').value);
  check('URL × button hides after the switch', $('urlClearBtn').hidden === true);

  // Fix 2a: × on the URL box.
  typeInto($('urlInput'), 'https://www.youtube.com/shorts/abc/');
  check('URL × button appears while typing', $('urlClearBtn').hidden === false);
  $('urlClearBtn').click();
  check('URL × clears the link box', $('urlInput').value === '');
  check('URL × hides after clearing', $('urlClearBtn').hidden === true);
  check('URL × puts the cursor back in the box', document.activeElement === $('urlInput'));

  // Fix 2b: × on the username box (DP is a tab inside the Instagram group).
  document.querySelector('.nav-item[data-tool="ig_reel"]').click();
  document.querySelector('.tab[data-tab-tool="ig_dp"]').click();
  typeInto($('usernameInput'), 'mr.kaifu_4u');
  check('username × button appears while typing', $('usernameClearBtn').hidden === false);
  $('usernameClearBtn').click();
  check('username × clears the box', $('usernameInput').value === '');
  // And the username box is cleared by a tool switch too.
  typeInto($('usernameInput'), 'someone_else');
  document.querySelector('.nav-item[data-tool="ig_reel"]').click();
  check('switching tools clears the username box', $('usernameInput').value === '');

  // Fix 2c: × on the history search (dashboard shows all platforms —
  // history is filtered per page, so check from the dashboard).
  document.querySelector('.nav-item[data-tool="dashboard"]').click();
  check('seeded history shows 2 rows', rows() === 2, 'rows=' + rows());
  typeInto($('historySearch'), 'travel');
  check('search filters to the matching row', rows() === 1, 'rows=' + rows());
  check('search × button appears while typing', $('historyClearBtn').hidden === false);
  $('historyClearBtn').click();
  check('search × clears the search box', $('historySearch').value === '');
  check('search × restores all rows', rows() === 2, 'rows=' + rows());

  // Fix 2d: clear-file button on the converter.
  document.querySelector('.nav-item[data-tool="to_song"]').click();
  const file = new window.File(['fake video bytes'], 'holiday.mp4', { type: 'video/mp4' });
  let chosenFiles = [file];
  Object.defineProperty($('audioFileInput'), 'files', {
    get() { return chosenFiles; },
    set(v) { chosenFiles = Array.from(v || []); },
    configurable: true
  });
  $('audioFileInput').dispatchEvent(new window.Event('change', { bubbles: true }));
  check('choosing a file shows its name', ($('audioFileName').textContent || '').includes('holiday.mp4'), $('audioFileName').textContent);
  check('clear-file button appears when a file is chosen', $('audioFileClearBtn').style.display !== 'none');
  $('audioFileClearBtn').click();
  check('clear-file resets the note', ($('audioFileName').textContent || '').startsWith('No file chosen'), $('audioFileName').textContent);
  check('clear-file button hides after clearing', $('audioFileClearBtn').style.display === 'none');

  // Fix 1 (converter file): switching tools clears the chosen file too.
  $('audioFileInput').dispatchEvent(new window.Event('change', { bubbles: true }));
  check('file chosen again before the switch', $('audioFileClearBtn').style.display !== 'none');
  document.querySelector('.nav-item[data-tool="ig_reel"]').click();
  check('switching tools clears the chosen file', $('audioFileInput').value === '' && ($('audioFileName').textContent || '').startsWith('No file chosen'));

  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
