// History search / platform filter / export test for the Video Downloader (jsdom).
const fs = require('fs');
const { JSDOM } = require('jsdom');

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
// Capture the CSV export instead of downloading it.
let capturedBlob = null;
window.Blob = class { constructor(parts) { this.parts = parts; } };
window.URL.createObjectURL = (blob) => { capturedBlob = blob; return 'blob:test'; };
window.HTMLAnchorElement.prototype.click = function () {};

window.eval(configJs);
window.eval(appJs);

const $ = (id) => document.getElementById(id);
let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}
function rows() { return document.querySelectorAll('#historyList tbody tr').length; }
function rowText() { return document.querySelector('#historyList').textContent; }
function setSearch(v) {
  $('historySearch').value = v;
  $('historySearch').dispatchEvent(new window.Event('input', { bubbles: true }));
}
function setPlatform(v) {
  $('historyPlatform').value = v;
  $('historyPlatform').dispatchEvent(new window.Event('change', { bubbles: true }));
}

const seed = [
  { date: '12/11/2026', time: '15:00:00', device: 'Desktop', platform: 'instagram', tool: 'ig_reel', video_url: 'https://www.instagram.com/reel/TravelVlog/', quality: '720p HD', format: 'MP4', city: 'Hyderabad' },
  { date: '12/11/2026', time: '15:01:00', device: 'Desktop', platform: 'youtube', tool: 'yt_short', video_url: 'https://www.youtube.com/shorts/PythonTutorial', quality: '720p HD', format: 'MP4', city: 'Hyderabad' },
  { date: '12/11/2026', time: '15:02:00', device: 'Desktop', platform: 'instagram', tool: 'to_song', video_url: 'song.mp4', quality: '192 kbps', format: 'MP3', city: 'Hyderabad' },
  { date: '12/11/2026', time: '15:03:00', device: 'Desktop', platform: 'facebook', tool: 'fb_video', video_url: 'https://www.facebook.com/watch/ProductDemo', quality: '720p HD', format: 'MP4', city: 'Hyderabad' }
];
window.localStorage.setItem('vd_history', JSON.stringify(seed));
document.querySelector('.nav-item[data-tool="dashboard"]').click();
check('seeded: dashboard shows all 4', rows() === 4, 'rows=' + rows());

setSearch('travel');
check('search "travel" shows only the reel', rows() === 1 && rowText().includes('TravelVlog'), 'rows=' + rows());
setSearch('mp3');
check('search "mp3" shows only the conversion', rows() === 1 && rowText().includes('song.mp4'), 'rows=' + rows());
setSearch('zzzz-no-match');
check('no-match search shows friendly message', document.querySelector('#historyList .empty') !== null && document.querySelector('#historyList .empty').textContent.includes('No downloads match'), (document.querySelector('#historyList .empty') || {}).textContent);
setSearch('');
check('clearing search restores all 4', rows() === 4, 'rows=' + rows());

setPlatform('youtube');
check('platform filter youtube shows only 1', rows() === 1 && rowText().includes('PythonTutorial'), 'rows=' + rows());
setPlatform('instagram');
check('platform filter instagram shows 2 (reel + conversion)', rows() === 2, 'rows=' + rows());
setSearch('song');
check('search + platform filter combine (instagram + song = 1)', rows() === 1 && rowText().includes('song.mp4'), 'rows=' + rows());

// Export must contain exactly the filtered view (1 row + header).
(async () => {
  $('exportHistoryBtn').click();
  const csv = capturedBlob.parts.join('');
  const lines = csv.trim().split('\n');
  check('export has header + exactly 1 filtered row', lines.length === 2, 'lines=' + lines.length);
  check('export row is the conversion', lines[1].includes('song.mp4') && lines[1].includes('to_song'), lines[1]);
  setSearch(''); setPlatform('');
  $('exportHistoryBtn').click();
  const csv2 = capturedBlob.parts.join('');
  check('export with no filter has all 4 rows', csv2.trim().split('\n').length === 5, 'lines=' + csv2.trim().split('\n').length);
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
