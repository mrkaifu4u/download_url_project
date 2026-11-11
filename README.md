# Video Downloader

Paste a video URL, preview it on screen, pick a quality, and download it
straight to your PC or phone. Dark poster style (bg `#070708`, red `#e8112d`,
Archivo, square buttons) — same look as the portfolio.

**Live demo:** open `index.html` directly, or deploy on Netlify / GitHub Pages
(static files only — no server, no build step).

## Tools

| Sidebar | What it does | API used |
|---|---|---|
| Dashboard | Paste any link — platform is auto-detected | — |
| Instagram → Reel Download | Reel / post video, HD | Instagram `/fetch` |
| Instagram → Story Download | Story link while it is still live | All-in-one `/extract` |
| Instagram → DP Download | Username → full-size profile picture | All-in-one `/extract` on profile URL |
| Instagram → Copy Reel Caption | Fetch a Reel, copy its caption | Instagram `/fetch` |
| Instagram → Copy Bio | Username → profile bio to clipboard | All-in-one `/extract` on profile URL |
| Facebook → Video Download | Facebook video link | All-in-one `/extract` |
| YouTube → Short Download | `youtube.com/shorts/…` / `youtu.be/…` | YouTube API, fallback all-in-one |
| YouTube → Full Video Download | `youtube.com/watch?v=…` | YouTube API, fallback all-in-one |
| Video to Song | Audio-only format → `.mp3` / `.m4a` | All-in-one `/extract` |

## API choices (RapidAPI)

| API | Host | Free plan | Notes |
|---|---|---|---|
| Instagram Downloader | `instagram-downloader-download-instagram-videos-stories1.p.rapidapi.com` | Per your RapidAPI subscription — set the limit in Settings | **Verified working 2026-11-11:** `GET /fetch?url=` returns `{ ok, download_url, thumbnail_url, caption, width, height, items[] }`. Carousel/album = `items[]`. Usually a single 720p HD URL. |
| YouTube Downloader 24 | `youtube-downloader24.p.rapidapi.com` | Basic free: **500 requests / month** | Check that API's own docs for its exact endpoint/params before subscribing — the app normalises whatever `formats` array it returns. |
| Social Media Downloader API Pro (all-in-one) | `social-media-downloader-api-pro.p.rapidapi.com` | Per subscription (default shown: 100/month) | `POST /extract` with `{ "url": "…" }` → `{ title, thumbnail, duration, formats: [{ quality: "1080p"/"720p"/"480p"/"360p"/"audio", url, ext }] }`. Used for Facebook, Story/DP/Bio attempts and Video-to-Song. |
| YouTube FAST Downloader (fallback) | — | Free: **100 requests / month, 50 MB max file** | Swap in as the YouTube host in `config.js` if the main YT API does not fit. |

How to pick: keep the Instagram API you already have for Reels, use
YouTube Downloader 24 for YouTube, and the all-in-one API for Facebook /
Story / DP / converter. All three share one RapidAPI key.

## Quota — how it is counted

- **1 paste + Fetch = 1 API call.** Downloading the media file itself costs
  nothing extra (it is a direct file URL, not an API call).
- Usage is counted in the browser (`localStorage`, keyed `YYYY-MM` per API)
  and shown as quota cards on the Dashboard: used / limit, remaining, and
  the reset date (**1st of next month**).
- If a limit is reached the app blocks the Fetch and says so — raise the
  limit in Settings if you upgrade your RapidAPI plan.

## Setup

### 1. Add your RapidAPI key (never commit it)

1. Open the app → **Settings**.
2. Paste your RapidAPI key. It is stored **only in this browser's
   localStorage** and sent only to RapidAPI when you press Fetch.
3. Optional: adjust the monthly limits to match your plan, add your
   Apps Script URL, Save.

> ⚠ The app ships with a RapidAPI key built into `config.js` — added by
> the owner on 2026-11-11 so visitors can fetch without pasting one.
> The repo is public, so anyone can view that key and every visitor's
> Fetch counts against the owner's quota. A key typed in Settings
> overrides the built-in one. If the quota is abused, rotate the key
> on RapidAPI and update `config.js`.

### 2. Connect Google Sheets (optional)

Sheet: **portfolio_webiste_database** — tab: **downloader_data**.

1. Open that spreadsheet → Extensions → Apps Script.
2. Paste `apps-script/Code.gs`, save.
3. Deploy → New deployment → Web app → **Execute as: Me, Who has
   access: Anyone** → copy the `…/exec` URL.
4. Paste it in the app under Settings → Save → **Test Sheet connection**.

Every fetch then appends a row:

`S.No | Date | Time | Device | Platform | Tool | Video URL | Quality | Location | Latitude | Longitude | Google Maps Link`

Location is **GPS-first** (`navigator.geolocation`, with your permission),
falling back to IP geolocation (`ipapi.co`) — IP alone once showed the
wrong town. If no Apps Script URL is set, entries are kept in local
history only and the app says so.

### 3. Publish

Push this folder to a public GitHub repo and enable GitHub Pages, or drag
it into Netlify Drop. No build, no server, no secrets in the repo.

## How to use

1. Pick a tool in the left sidebar (or just paste a link — the platform
   is auto-detected).
2. Press **Fetch video** — the video appears in the preview card with its
   thumbnail, title, caption, author and duration.
3. Pick a **quality pill** (1080p / 720p / 480p / 360p / audio).
4. Press **Download** — the file saves to Downloads (PC) or
   Files/Downloads (phone). On some phones the video may open in a tab
   instead; long-press → Save video.

**Demo:** the "Demo preview" button loads a sample video with no key and
no API call, so you can see the layout first.

## Limitations (honest)

- **Story / DP / Bio** need a profile-capable API. The given Instagram
  `/fetch` endpoint only resolves Reel/post URLs — Story, DP and Bio go
  through the all-in-one `/extract` on the profile/story URL, and will
  fail with a clear message if that API is not subscribed or does not
  return profile data. Private accounts cannot be downloaded.
- **YouTube quality** depends entirely on what the subscribed YT API
  returns in its `formats` array. If it returns one format, you get one
  pill; if it returns 1080p/720p/480p/360p/audio, you get them all.
  YouTube's own terms restrict downloading — use only content you own
  or have rights to.
- **Video to Song** downloads the audio stream the API returns
  (`.mp3` / `.m4a`). The browser cannot transcode video to audio locally.
  If the API returns video-only, there is no audio pill to pick.
- **Download on phones:** some browsers/CDNs ignore the `download`
  attribute cross-origin and open the video in a tab instead — the app
  falls back to a direct link and tells you to long-press → Save.
- **Quota is per-browser:** usage is counted in localStorage on each
  device, not on RapidAPI's server — RapidAPI's own dashboard is the
  source of truth for billing.
- **Location** needs your permission for GPS; without it the IP fallback
  is approximate.

## Legal

Download only content you own or have the right to download, and only
public content. Personal use only unless you have permission. This app is
not affiliated with Instagram, Facebook, YouTube or RapidAPI.

## Admin Panel (`admin.html`)

A separate admin interface — **not linked from the user app** (no admin
link in `index.html`; open it directly at `…/admin.html`). Normal users
never see admin pages, API details, database info or other users.

### Setup

1. Deploy `apps-script/Code.gs` as a Web App (same steps as §2 above —
   the same script is both the download logger and the admin backend).
2. Open `admin.html`. If no admin exists yet you get the **Create first
   admin** setup screen: enter an email and a password (min 8 chars).
   There is **no default password anywhere** — the setup screen is the
   only way to create the first admin.
3. Log in with that email/password. On first login you are **forced to
   change the password**. Sessions last 30 minutes of inactivity, with a
   countdown in the top bar; "Remember me" is the only way a session is
   kept in `localStorage` (otherwise it lives in `sessionStorage`).
4. If the backend URL is missing or unreachable, the login screen says
   so and **refuses login** — there is no offline login.

### What the admin can do

Dashboard (real stats only — 0 / empty when there is nothing), Users &
Access (create/edit/block/delete, passwords are hashed server-side and
never displayed), API Management (hosts from `config.js`, masked keys,
real Test button — each test uses 1 API call, enable/disable per API),
Accounts (Instagram/YouTube/Facebook — honestly "Not connected", since
downloads use RapidAPI with no account login), Usage & Reports, Download
Logs (the exact 12 `downloader_data` columns, search/filters/pagination/
CSV export, Google Maps links from saved coordinates only), Database
(Sheet tabs with row counts, record search, CSV export, JSON backup;
**Restore is not in v1** — restore by re-importing the CSV in the
Sheet; no SQL execution from the browser, ever), App Settings (app name,
monthly limits, maintenance mode, backup settings), Audit Logs (every
admin action, with date/time/admin/action/result).

### Security limits — read before relying on this

- Passwords are stored as **SHA-256 + per-account salt** in the Sheet
  (`dl_admin`); session tokens are stored only as hashes in
  `dl_sessions` with a 30-minute sliding expiry. The backend rejects
  every unauthenticated call.
- **But:** this is a static site + Apps Script, not enterprise auth.
  `admin.html` is unlinked but its URL is guessable, and GitHub Pages
  has no server-side route protection — the backend is the only gate.
  There is no brute-force lockout beyond the Sheet. For stronger
  guarantees, a dedicated backend is needed.
- **The public app has no login wall in v1.** User management in the
  admin is a real list, but it cannot block anonymous downloads —
  enforcing a login gate on the public app is a separate decision.
- Maintenance mode (App Settings) shows a notice in `index.html` and
  disables Fetch; disabling an API in API Management blocks Fetches
  for that host in `index.html`. Both are read from `localStorage`
  (`vd_app_settings`), which the admin page also saves to the Sheet.

## Files

| File | What it is |
|---|---|
| `index.html` | Dashboard, sidebar, preview, quota, history, settings |
| `style.css` | All styling + animations + mobile responsive |
| `config.js` | API hosts, default limits, tool list — **built-in RapidAPI key** (owner's choice, public repo — see warning above) |
| `app.js` | Fetch/preview/download, quota, history, Sheets logging, GPS; reads admin settings (`vd_app_settings`) for maintenance mode, disabled hosts, limits |
| `admin.html` / `admin.css` / `admin.js` | Admin login + dashboard (users, APIs, accounts, usage, logs, database, settings, audit) — separate page, not linked from `index.html` |
| `apps-script/Code.gs` | Sheets logger (`downloader_data` tab) + admin backend (login, users, stats, logs, settings, audit, backup) |
| `.env.example` / `.gitignore` | Key shape only; keep real keys out of git |
