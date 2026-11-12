// v12 desktop checks (puppeteer, real Chrome, local copy of the live
// files): (A) Monthly Download Usage grid fits at 1080px and 1280px
// (the reported screenshot showed the 4th card cut off); (B) the new
// Download result card works end-to-end in the browser with a mocked
// Instagram API reply; (C) section order on the Instagram page.
const puppeteer = require('puppeteer');
const fs = require('fs');

const BASE = 'http://127.0.0.1:8138/index.html';
const SHOTS = '/home/hatch/workspace/video-downloader/tests/screenshots';

const SEED = `
localStorage.setItem('vd_history', JSON.stringify([
  {date:'12/11/2026',time:'15:55:37',device:'Desktop',platform:'instagram',tool:'ig_reel',video_url:'https://www.instagram.com/reel/DeEvB06NaqX/',quality:'720p HD',format:'MP4',city:'Location not shared (none)',lat:'',lng:'',mapsLink:''},
  {date:'12/11/2026',time:'16:02:01',device:'Desktop',platform:'local',tool:'to_song',video_url:'flower.mp4',quality:'192 kbps',format:'MP3',city:'Location not shared (none)',lat:'',lng:'',mapsLink:''}
]));
localStorage.setItem('vd_quota', JSON.stringify({'2026-11':{instagram:14,youtube:0,allinone:0,ig_profile:3}}));
`;

// Mock the Instagram API inside the page so the full fetch flow runs
// without internet (the test Chrome cannot use the egress proxy).
const MOCK_API = `
const _realFetch = window.fetch.bind(window);
window.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('instagram-downloader-download-instagram-videos-stories1')) {
    return { ok: true, json: async () => ({ ok: true, download_url: 'https://fake-fbcdn/reel.mp4', caption: 'My test reel caption — a longer caption to check the text box wraps nicely.', width: 720, height: 1280, thumbnail_url: '' }) };
  }
  return _realFetch(url, opts);
};
`;

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });

  /* ---------- A. Usage grid fits at desktop widths ---------- */
  for (const w of [1080, 1280]) {
    const p = await browser.newPage();
    await p.setViewport({ width: w, height: 800 });
    await p.evaluateOnNewDocument(SEED);
    await p.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
    await sleep(800);
    const m = await p.evaluate(() => {
      const cards = Array.from(document.querySelectorAll('#quotaGrid .quota')).map((el) => {
        const r = el.getBoundingClientRect();
        return { right: Math.round(r.right), left: Math.round(r.left) };
      });
      return { vw: document.documentElement.clientWidth, docScroll: document.documentElement.scrollWidth, cards };
    });
    check('usage grid fits at ' + w + 'px (page ' + m.docScroll + 'px wide)', m.docScroll <= w + 1, JSON.stringify(m));
    check('all 4 usage cards fully inside the viewport at ' + w + 'px', m.cards.length === 4 && m.cards.every((c) => c.right <= w && c.left >= 0), JSON.stringify(m.cards));
    await p.evaluate(() => document.getElementById('quotaCard').scrollIntoView());
    await sleep(400);
    await p.screenshot({ path: SHOTS + '/desktop-usage-' + w + '.png' });
    await p.close();
  }

  /* ---------- B. Result card end-to-end + section order ---------- */
  const p = await browser.newPage();
  await p.setViewport({ width: 1280, height: 900 });
  await p.evaluateOnNewDocument(SEED + MOCK_API);
  await p.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(800);
  await p.click('.nav-item[data-tool="ig_reel"]');
  await sleep(500);
  await p.type('#urlInput', 'https://www.instagram.com/reel/DeEvB06NaqX/');
  await p.click('#fetchBtn');
  await p.waitForFunction(() => document.getElementById('resultCard').classList.contains('show'), { timeout: 20000 });
  await sleep(500);
  const r = await p.evaluate(() => {
    const sel = document.getElementById('qualitySelect');
    const order = ['fetchCard', 'resultCard', 'quotaCard', 'historyCard'].map((id) => {
      const e = document.getElementById(id);
      return { id, order: getComputedStyle(e).order, top: Math.round(e.getBoundingClientRect().top + window.scrollY) };
    });
    return {
      hasVideo: !!document.querySelector('video'),
      hasPreviewCard: !!document.getElementById('previewCard'),
      title: document.getElementById('resultTitle').textContent,
      captionShown: document.getElementById('resultCaption').style.display !== 'none',
      options: Array.from(sel.options).map((o) => o.textContent),
      downloadEnabled: !document.getElementById('downloadBtn').disabled,
      order
    };
  });
  check('result card: no video element, no Preview card', !r.hasVideo && !r.hasPreviewCard);
  check('result card: title + caption shown', /My test reel caption/.test(r.title) && r.captionShown, r.title);
  check('result card: Original option in the dropdown', r.options.length === 1 && /^Original — 720p HD · MP4$/.test(r.options[0]), JSON.stringify(r.options));
  check('result card: Download enabled', r.downloadEnabled);
  const tops = Object.fromEntries(r.order.map((o) => [o.id, o.top]));
  check('instagram page order: fetch < result < usage < history (last)',
    tops.fetchCard < tops.resultCard && tops.resultCard < tops.quotaCard && tops.quotaCard < tops.historyCard,
    JSON.stringify(r.order));
  await p.evaluate(() => document.getElementById('resultCard').scrollIntoView());
  await sleep(400);
  await p.screenshot({ path: SHOTS + '/desktop-result.png' });
  await p.close();

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
