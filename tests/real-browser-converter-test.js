// Real-browser converter test (puppeteer): proves the v19 fix — after
// a file upload + conversion, the Download button appears INSIDE the
// Video to Audio Converter card (not in the separate Download section
// below), and pressing it saves the audio. The VM's Chrome has no
// internet, so the ffmpeg ESM modules from unpkg are stubbed at the
// network edge: the stub "converts" instantly and returns 8 fake MP3
// bytes, which must land in the Downloads folder byte-complete.
const puppeteer = require('/home/hatch/workspace/node_modules/puppeteer-core');
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = path.join(process.env.HOME, '.cache/puppeteer/chrome/linux-157.0.8103.50/chrome-linux64/chrome');
const SRC = '/home/hatch/workspace/video-downloader';
const COPY = '/tmp/kf-convtest';
const APP_PORT = 8152;
const DL_DIR = '/tmp/dl-test/conv-downloads';
const FAKE_MP3 = Buffer.from([255, 251, 144, 0, 1, 2, 3, 4]);

const FFMPEG_STUB = `
export class FFmpeg {
  async load() {}
  async writeFile() {}
  async exec() { return 0; }
  async readFile() { return new Uint8Array([255, 251, 144, 0, 1, 2, 3, 4]); }
  on() {}
  off() {}
}
`;
const UTIL_STUB = `
export async function toBlobURL() { return 'blob:fake'; }
`;

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

(async () => {
  execSync('rm -rf ' + COPY + ' && cp -r ' + SRC + ' ' + COPY);
  execSync('rm -rf ' + DL_DIR + ' && mkdir -p ' + DL_DIR);
  const appServer = spawn('python3', ['-m', 'http.server', String(APP_PORT)], { cwd: COPY, stdio: 'ignore' });
  await new Promise((r) => setTimeout(r, 1200));
  const browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    const cdp = await page.createCDPSession();
    await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL_DIR });
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const u = req.url();
      if (u.startsWith('https://unpkg.com/@ffmpeg/ffmpeg@')) {
        req.respond({ status: 200, contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: FFMPEG_STUB });
      } else if (u.startsWith('https://unpkg.com/@ffmpeg/util@')) {
        req.respond({ status: 200, contentType: 'text/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: UTIL_STUB });
      } else req.continue();
    });
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto('http://127.0.0.1:' + APP_PORT + '/index.html', { waitUntil: 'domcontentloaded' });
    await page.click('.nav-item[data-tool="to_song"]');
    const fileInput = await page.$('#audioFileInput');
    await fileInput.uploadFile(SRC + '/test-assets/flower.mp4');
    await page.waitForFunction(() => (document.getElementById('audioFileName').textContent || '').includes('flower.mp4'), { timeout: 5000 });
    check('file chosen', true);
    await page.click('#convertBtn');
    await page.waitForFunction(() => document.getElementById('convertDownloadBtn').style.display !== 'none', { timeout: 30000 });
    check('converter Download button appears in the converter card', true);
    const btnText = await page.$eval('#convertDownloadBtn', (e) => e.textContent);
    check('button says Download MP3', btnText.includes('Download MP3'), 'text=' + btnText);
    const resultShown = await page.$eval('#resultCard', (e) => e.classList.contains('show'));
    check('separate Download section stays hidden for converter results', resultShown === false);
    const inConverterCard = await page.evaluate(() => document.getElementById('converterCard').contains(document.getElementById('convertDownloadBtn')));
    check('button lives inside the converter card', inConverterCard === true);
    await page.click('#convertDownloadBtn');
    const start = Date.now();
    let files = [];
    while (Date.now() - start < 30000) {
      await new Promise((r) => setTimeout(r, 500));
      files = fs.readdirSync(DL_DIR).filter((f) => !f.endsWith('.crdownload'));
      if (files.length) break;
    }
    check('audio file landed in Downloads', files.length === 1, 'files=' + JSON.stringify(files));
    if (files.length === 1) {
      const got = fs.readFileSync(path.join(DL_DIR, files[0]));
      check('downloaded audio is the converted bytes', Buffer.compare(got, FAKE_MP3) === 0, 'bytes=' + got.length);
    }
    // Switching tools hides the converter Download button again.
    await page.click('.nav-item[data-tool="ig_reel"]');
    const hiddenAfterSwitch = await page.$eval('#convertDownloadBtn', (e) => e.style.display === 'none');
    check('converter Download button hides on tool switch', hiddenAfterSwitch === true);
  } finally {
    await browser.close();
    appServer.kill();
  }
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
