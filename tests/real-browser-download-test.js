// Real-browser end-to-end download test (puppeteer): proves the app's
// download path works in a REAL Chrome, not just jsdom. The VM's Chrome
// has no internet, so a local video server stands in for fbcdn: it
// serves the real test file with CORS + Range support, and /flaky.mp4
// kills the connection halfway on the first request (like the phone's
// network) so the resume path is exercised for real. The IG API is
// mocked at the network edge to return the local video URL. The file
// must land in the browser's Downloads folder byte-complete.
const puppeteer = require('/home/hatch/workspace/node_modules/puppeteer-core');
const { execSync, spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const CHROME = path.join(process.env.HOME, '.cache/puppeteer/chrome/linux-157.0.8103.50/chrome-linux64/chrome');
const SRC = '/home/hatch/workspace/video-downloader';
const COPY = '/tmp/kf-dltest';
const APP_PORT = 8151, VID_PORT = 8150;
const DL_DIR = '/tmp/dl-test/downloads';
// VIDEO_FILE env var lets this test serve any real file (e.g. a reel
// downloaded with curl) instead of the bundled test clip.
const VIDEO_FILE = process.env.VIDEO_FILE || (SRC + '/test-assets/flower.mp4');
const FILE = fs.readFileSync(VIDEO_FILE);

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

// Video server: CORS + Range, like fbcdn. /flaky.mp4 destroys the
// socket after half the file on the first (non-Range) request.
function startVideoServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'OPTIONS') {
      res.writeHead(200, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'range' });
      return res.end();
    }
    if (url.pathname !== '/video.mp4' && url.pathname !== '/flaky.mp4') { res.writeHead(404); return res.end(); }
    const range = req.headers.range;
    let start = 0, end = FILE.length - 1, status = 200;
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range);
      if (m) { start = Number(m[1]); if (m[2]) end = Number(m[2]); status = 206; }
    }
    const headers = {
      'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*', 'Content-Length': String(end - start + 1)
    };
    if (status === 206) headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + FILE.length;
    res.writeHead(status, headers);
    if (url.pathname === '/flaky.mp4' && !range) {
      res.write(FILE.slice(0, Math.floor(FILE.length / 2)));
      setTimeout(() => { try { res.socket.destroy(); } catch {} }, 50);
      return;
    }
    res.end(FILE.slice(start, end + 1));
  });
  return new Promise((resolve) => server.listen(VID_PORT, '127.0.0.1', () => resolve(server)));
}

async function runCase(name, videoPath) {
  execSync('rm -rf ' + DL_DIR + ' && mkdir -p ' + DL_DIR);
  const browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    const cdp = await page.createCDPSession();
    await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL_DIR });
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const u = req.url();
      if (u.includes('/fetch?url=')) {
        // The app sends x-rapidapi-key headers, so the browser
        // preflights first — answer the preflight like RapidAPI does.
        if (req.method() === 'OPTIONS') {
          req.respond({ status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'x-rapidapi-key, x-rapidapi-host, content-type' } });
          return;
        }
        req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify({ ok: true, download_url: 'http://127.0.0.1:' + VID_PORT + videoPath, caption: 'test reel', width: 720, height: 1280, thumbnail_url: '' }) });
      } else req.continue();
    });
    await page.setViewport({ width: 1280, height: 900 }); // desktop: sidebar visible (download code is viewport-independent)
    await page.goto('http://127.0.0.1:' + APP_PORT + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.click('.nav-item[data-tool="ig_reel"]');
    await page.type('#urlInput', 'https://www.instagram.com/reel/DeEvB06NaqX/');
    await page.click('#fetchBtn');
    await page.waitForFunction(() => (document.getElementById('status').textContent || '').includes('video is ready'), { timeout: 20000 });
    check(name + ': fetch succeeds', true);
    await page.click('#downloadBtn');
    const start = Date.now();
    let files = [];
    while (Date.now() - start < 60000) {
      await new Promise((r) => setTimeout(r, 500));
      files = fs.readdirSync(DL_DIR).filter((f) => !f.endsWith('.crdownload'));
      if (files.length) break;
    }
    const status = await page.$eval('#status', (e) => e.textContent || '');
    const progressText = await page.$eval('#progressText', (e) => e.textContent || '');
    check(name + ': download reported success', /download has started/i.test(status), 'status=' + status + ' progress=' + progressText);
    check(name + ': file landed in Downloads', files.length === 1, 'files=' + JSON.stringify(files));
    if (files.length === 1) {
      const got = fs.readFileSync(path.join(DL_DIR, files[0]));
      check(name + ': file is byte-complete (' + got.length + ' bytes)', Buffer.compare(got, FILE) === 0, 'expected ' + FILE.length);
    }
  } finally {
    await browser.close();
  }
}

(async () => {
  execSync('rm -rf ' + COPY + ' && cp -r ' + SRC + ' ' + COPY);
  const appServer = spawn('python3', ['-m', 'http.server', String(APP_PORT)], { cwd: COPY, stdio: 'ignore' });
  const vidServer = await startVideoServer();
  await new Promise((r) => setTimeout(r, 1200));
  try {
    await runCase('real Chrome, normal download', '/video.mp4');
    await runCase('real Chrome, connection killed halfway then resumed', '/flaky.mp4');
  } finally {
    appServer.kill();
    vidServer.close();
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
