// v14 KAIFFLOW rebrand + colour redesign — visual + brand checks.
// Run: node tests/v14-brand-test.js (serves a local copy on 127.0.0.1:8141).
// Checks: KAIFFLOW title/brand text, gradient primary buttons, purple
// accents, admin login branding, no horizontal overflow at 390px.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const puppeteer = require('puppeteer-core');

const CHROME = path.join(process.env.HOME, '.cache/puppeteer/chrome/linux-157.0.8103.50/chrome-linux64/chrome');
const SRC = path.join(__dirname, '..');
const COPY = '/tmp/kf14';
const PORT = 8141;

let pass = 0, fail = 0;
function check(name, ok, extra = '') {
  if (ok) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, extra); }
}

(async () => {
  execSync(`rm -rf ${COPY} && cp -r ${SRC} ${COPY}`);
  const server = require('child_process').spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: COPY, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 1200));
  const browser = await puppeteer.launch({ executablePath: CHROME, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  try {
    const shots = path.join(__dirname, 'screenshots');
    fs.mkdirSync(shots, { recursive: true });

    // ---------- Desktop ----------
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 800));

    check('document.title is KAIFFLOW', (await page.title()).startsWith('KAIFFLOW'), await page.title());
    const brand = await page.$eval('.brand h1', el => el.textContent.replace(/\s+/g, ''));
    check('sidebar brand reads KAIFFLOW', brand.toUpperCase() === 'KAIFFLOW', brand);
    const tagline = await page.$eval('.brand small', el => el.textContent);
    check('sidebar tagline', tagline === 'Download. Convert. Enjoy.', tagline);
    const sub = await page.$eval('#pageSub', el => el.textContent);
    check('dashboard subtitle is the new English text', sub === 'Welcome to KAIFFLOW! Choose what you want below — Instagram, YouTube, Facebook or Video to Audio — then paste a link and download.', sub.slice(0, 60));
    const btnBg = await page.$eval('#fetchBtn', el => getComputedStyle(el).backgroundImage);
    check('primary button is a gradient', btnBg.includes('linear-gradient'), btnBg.slice(0, 80));
    const btnBgImg = btnBg;
    check('gradient uses purple + pink', btnBgImg.includes('139, 92, 246') && btnBgImg.includes('236, 72, 153'), btnBgImg.slice(0, 120));
    const ghostBg = await page.$eval('#markAllReadBtn', el => getComputedStyle(el).backgroundImage);
    check('ghost button stays solid (no gradient)', ghostBg === 'none', ghostBg.slice(0, 60));
    const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    check('page background is #0B0B12', bodyBg === 'rgb(11, 11, 18)', bodyBg);
    const navBg = await page.$eval('.nav-item.active', el => getComputedStyle(el).backgroundImage);
    check('active nav item is gradient', navBg.includes('linear-gradient'), navBg.slice(0, 80));
    const markBg = await page.$eval('.brand-mark', el => getComputedStyle(el).backgroundImage);
    check('brand mark is gradient', markBg.includes('linear-gradient'), markBg.slice(0, 80));
    await page.screenshot({ path: path.join(shots, 'v14-desktop-dashboard.png'), fullPage: true });

    // Instagram page: tab active state + fetch card
    await page.click('.nav-item[data-tool="ig_reel"]');
    await new Promise(r => setTimeout(r, 600));
    const tabBg = await page.$eval('.tab.active', el => getComputedStyle(el).backgroundImage);
    check('active tab is gradient', tabBg.includes('linear-gradient'), tabBg.slice(0, 80));
    await page.screenshot({ path: path.join(shots, 'v14-desktop-instagram.png'), fullPage: true });

    // Converter page
    await page.click('.nav-item[data-tool="to_song"]');
    await new Promise(r => setTimeout(r, 600));
    await page.screenshot({ path: path.join(shots, 'v14-desktop-converter.png'), fullPage: true });

    // ---------- Admin login ----------
    const ap = await browser.newPage();
    await ap.setViewport({ width: 1280, height: 900 });
    await ap.goto(`http://127.0.0.1:${PORT}/admin.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 800));
    check('admin title is KAIFFLOW', (await ap.title()).includes('KAIFFLOW'), await ap.title());
    const abrand = await ap.$eval('.brand h1', el => el.textContent.replace(/\s+/g, ''));
    check('admin login brand reads KAIFFLOW', abrand.toUpperCase() === 'KAIFFLOW', abrand);
    const abtn = await ap.$eval('#view-login button[type="submit"]', el => getComputedStyle(el).backgroundImage);
    check('admin login button is gradient', abtn.includes('linear-gradient'), abtn.slice(0, 80));
    await ap.screenshot({ path: path.join(shots, 'v14-admin-login.png'), fullPage: true });
    await ap.close();

    // ---------- Mobile 390px ----------
    const m = await browser.newPage();
    await m.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true });
    await m.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 800));
    const overflow = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check('mobile: no horizontal overflow', overflow <= 0, 'overflow ' + overflow + 'px');
    const mbrand = await m.$eval('.topbar-brand strong', el => el.textContent);
    check('mobile topbar brand Kaif', mbrand === 'Kaif', mbrand);
    const mspan = await m.$eval('.topbar-brand span', el => el.textContent);
    check('mobile topbar brand flow', mspan === 'flow', mspan);
    await m.screenshot({ path: path.join(shots, 'v14-mobile-dashboard.png'), fullPage: true });
    await m.click('#hamburger');
    await new Promise(r => setTimeout(r, 500));
    await m.screenshot({ path: path.join(shots, 'v14-mobile-drawer.png') });
    await m.click('.nav-item[data-tool="ig_reel"]');
    await new Promise(r => setTimeout(r, 700));
    const moverflow = await m.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check('mobile instagram: no horizontal overflow', moverflow <= 0, 'overflow ' + moverflow + 'px');
    await m.screenshot({ path: path.join(shots, 'v14-mobile-instagram.png'), fullPage: true });
    await m.close();
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
