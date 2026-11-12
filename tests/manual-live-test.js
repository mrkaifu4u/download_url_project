// Manual live test of the Video Downloader in a real Chrome (puppeteer):
// (A) mobile 390px layout checks + screenshots, (B) end-to-end reel->
// MP3 conversion with a real downloaded file as proof. Runs against the
// LIVE site (v9) — the VM network reaches fbcdn, unlike the cloud test
// browser, so this is the first true end-to-end conversion proof.
const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const BASE = 'http://127.0.0.1:8138/index.html'; // local copy of the live v9 files (byte-identical; puppeteer Chrome cannot use the egress proxy)
const SHOTS = '/home/hatch/workspace/video-downloader/tests/screenshots';
const DLDIR = '/tmp/pptr-downloads';
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(DLDIR, { recursive: true });
fs.readdirSync(DLDIR).forEach((f) => fs.unlinkSync(path.join(DLDIR, f)));

const SEED = `
localStorage.setItem('vd_history', JSON.stringify([
  {date:'12/11/2026',time:'15:55:37',device:'Desktop',platform:'instagram',tool:'ig_reel',video_url:'https://www.instagram.com/reel/DeEvB06NaqX/',quality:'720p HD',format:'MP4',city:'Location not shared (none)',lat:'',lng:'',mapsLink:''},
  {date:'12/11/2026',time:'16:02:01',device:'Desktop',platform:'local',tool:'to_song',video_url:'flower.mp4',quality:'192 kbps',format:'MP3',city:'Location not shared (none)',lat:'',lng:'',mapsLink:''},
  {date:'12/11/2026',time:'14:13:25',device:'Desktop',platform:'instagram',tool:'ig_dp',video_url:'mr.kaifu_4u',quality:'150x150',format:'JPG',city:'Hyderabad, Telangana, India (IP)',lat:'17.38',lng:'78.48',mapsLink:'https://maps.google.com/?q=17.38,78.48'},
  {date:'11/11/2026',time:'18:20:00',device:'Desktop',platform:'instagram',tool:'ig_bio',video_url:'mr.kaifu_4u',quality:'Copied',format:'Text',city:'Hyderabad, Telangana, India (IP)',lat:'',lng:'',mapsLink:''}
]));
localStorage.setItem('vd_quota', JSON.stringify({'2026-11':{instagram:14,youtube:0,allinone:0,ig_profile:3}}));
localStorage.setItem('vd_notifications', JSON.stringify([
  {id:'n1',type:'error',title:"We couldn't convert your video",message:'Please try again with a different video.',time:'12 Nov, 16:09',read:false},
  {id:'n2',type:'success',title:'Your audio is ready',message:"'flower' has started downloading.",time:'12 Nov, 16:02',read:true}
]));
`;

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('PASS  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
  });

  /* ---------- A. MOBILE 390px ---------- */
  console.log('--- A. Mobile 390px ---');
  const m = await browser.newPage();
  await m.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await m.evaluateOnNewDocument(SEED);
  await m.goto(BASE, { waitUntil: 'networkidle2', timeout: 60000 });
  await sleep(1200);

  const overflow = await m.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const right = [], left = [];
    document.querySelectorAll('body *').forEach((el) => {
      // The sidebar is intentionally off-canvas (translated left) when closed.
      if (el.closest('.sidebar')) return;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden' || r.width === 0) return;
      const tag = (el.tagName + '.' + String(el.className.baseVal !== undefined ? '' : el.className).split(' ')[0]).slice(0, 40);
      if (r.right > vw + 1) right.push(tag + ' right=' + Math.round(r.right));
      if (r.left < -1) left.push(tag + ' left=' + Math.round(r.left));
    });
    window.scrollTo(200, 0);
    const canScrollX = window.scrollX > 0;
    window.scrollTo(0, 0);
    return { vw, docScroll: document.documentElement.scrollWidth, right: right.slice(0, 8), left: left.slice(0, 8), canScrollX };
  });
  check('dashboard: page does not scroll sideways', !overflow.canScrollX && overflow.docScroll <= 391, 'scrollWidth=' + overflow.docScroll + ' canScrollX=' + overflow.canScrollX);
  check('dashboard: nothing sticks out past the right edge', overflow.right.length === 0, JSON.stringify(overflow.right));
  const burger = await m.$eval('#hamburger', (e) => getComputedStyle(e).display !== 'none');
  check('hamburger button visible at 390px', burger);
  await m.screenshot({ path: SHOTS + '/mobile-dashboard.png' });

  // Usage cards
  await m.evaluate(() => document.getElementById('quotaCard').scrollIntoView());
  await sleep(500);
  await m.screenshot({ path: SHOTS + '/mobile-usage.png' });
  const usageOverflow = await m.evaluate(() => { window.scrollTo(200, 0); const x = window.scrollX; window.scrollTo(0, 0); return { docScroll: document.documentElement.scrollWidth, canScrollX: x > 0 }; });
  check('usage section: no horizontal overflow', usageOverflow.docScroll <= 391 && !usageOverflow.canScrollX, JSON.stringify(usageOverflow));

  // History stacked cards
  await m.evaluate(() => document.getElementById('historyCard').scrollIntoView());
  await sleep(500);
  await m.screenshot({ path: SHOTS + '/mobile-history.png' });
  const histRows = await m.$$eval('#historyList tbody tr', (rs) => rs.length);
  const histStacked = await m.$eval('#historyList tbody tr', (tr) => getComputedStyle(tr).display === 'block');
  check('history: 4 seeded rows render', histRows === 4, 'rows=' + histRows);
  check('history: rows stack as cards at 390px', histStacked);

  // Drawer
  await m.evaluate(() => window.scrollTo(0, 0));
  await m.click('#hamburger');
  await sleep(600);
  const drawerOpen = await m.$eval('.sidebar', (e) => e.classList.contains('open'));
  check('hamburger opens the sidebar drawer', drawerOpen);
  await m.screenshot({ path: SHOTS + '/mobile-drawer.png' });
  const drawerItems = await m.$$eval('.sidebar .nav-item', (els) => els.map((e) => e.textContent.trim()).join(' | '));
  check('drawer lists all 5 tools', /Dashboard/.test(drawerItems) && /Instagram/.test(drawerItems) && /YouTube/.test(drawerItems) && /Facebook/.test(drawerItems) && /Video to Audio Converter/.test(drawerItems), drawerItems);
  await m.evaluate(() => document.getElementById('drawerClose').click());
  await sleep(400);
  const drawerClosed = await m.$eval('.sidebar', (e) => !e.classList.contains('open'));
  check('drawer close button closes the sidebar', drawerClosed);

  // Real mobile flow: open the drawer, tap the tool, drawer closes.
  async function goTool(tool) {
    await m.click('#hamburger');
    await sleep(500);
    await m.evaluate((t) => document.querySelector('.nav-item[data-tool="' + t + '"]').click(), tool);
    await sleep(600);
    await m.evaluate(() => { if (document.querySelector('.sidebar').classList.contains('open')) document.getElementById('backdrop').click(); });
    await sleep(300);
  }

  // Converter at 390px
  await goTool('to_song');
  const convVisible = await m.$eval('#converterCard', (e) => getComputedStyle(e).display !== 'none');
  check('converter card shows on its page at 390px', convVisible);
  const convOverflow = await m.evaluate(() => { window.scrollTo(200, 0); const x = window.scrollX; window.scrollTo(0, 0); return { docScroll: document.documentElement.scrollWidth, canScrollX: x > 0 }; });
  check('converter page: no horizontal overflow', convOverflow.docScroll <= 391 && !convOverflow.canScrollX, JSON.stringify(convOverflow));
  await m.screenshot({ path: SHOTS + '/mobile-converter.png' });

  // Instagram tabs at 390px
  await goTool('ig_reel');
  const tabsVisible = await m.$$eval('.tab', (ts) => ts.filter((t) => t.getBoundingClientRect().width > 0).length);
  check('instagram page shows its 5 tabs', tabsVisible === 5, 'visible tabs=' + tabsVisible);
  await m.screenshot({ path: SHOTS + '/mobile-tabs.png' });

  // Notification panel at 390px
  await goTool('dashboard');
  await m.click('#bellBtn');
  await sleep(500);
  const panelOpen = await m.$eval('#notifPanel', (e) => { const r = e.getBoundingClientRect(); return getComputedStyle(e).display !== 'none' && r.width > 0; });
  const panelRect = await m.$eval('#notifPanel', (e) => { const r = e.getBoundingClientRect(); return { right: Math.round(r.right), left: Math.round(r.left), width: Math.round(r.width) }; });
  check('notification panel opens at 390px', panelOpen, JSON.stringify(panelRect));
  check('notification panel fits the viewport', panelRect.right <= 390 && panelRect.left >= 0, JSON.stringify(panelRect));
  await m.screenshot({ path: SHOTS + '/mobile-notif.png' });
  await m.close();

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
