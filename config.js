/* ==========================================================================
   KAIFFLOW — config.js
   --------------------------------------------------------------------------
   WARNING: this file contains a built-in RapidAPI key, added at the
   owner's explicit request (2026-11-11) so visitors can use the app
   without pasting a key. This repo is PUBLIC — anyone can view source
   and copy this key, and every visitor's Fetch counts against the
   owner's RapidAPI quota. If the quota is abused, rotate the key on
   RapidAPI and update it here. A key typed in Settings overrides it.
   ========================================================================== */

/**
 * RapidAPI hosts used by this app.
 *
 * Instagram — the host the user already has:
 *   instagram-downloader-download-instagram-videos-stories1.p.rapidapi.com
 *   Endpoint:  GET https://{host}/fetch?url=<instagram-url>
 *   Response:  { ok: true, id, download_url, thumbnail_url, caption,
 *                width, height, items: [{ download_url, ... }] }
 *   Verified 2026-11-11: returns download_url / thumbnail / caption.
 *   Free-plan quota is whatever your RapidAPI subscription for this API
 *   allows — check the API page on RapidAPI for the current limit and
 *   set it in Settings > Monthly limits.
 *
 * All-in-one (Instagram / Facebook / TikTok / X / Pinterest …):
 *   social-media-downloader-api-pro.p.rapidapi.com
 *   Endpoint:  POST https://social-media-downloader-api-pro.p.rapidapi.com/extract
 *   Body:      { url: "<video-url>" }   (JSON, Content-Type: application/json)
 *   Response:  { title, thumbnail, duration, formats: [
 *                { quality: "1080p", url, ext, ... },
 *                { quality: "720p",  url, ext, ... },
 *                { quality: "audio", url, ext: "mp3"/"m4a", ... } ] }
 *   Used for: Facebook video, YouTube fallback, Story/DP attempts,
 *   Video-to-Song (audio-only format).
 *
 * YouTube:
 *   youtube-downloader24.p.rapidapi.com
 *   Basic (free) plan: 500 requests / month (per RapidAPI listing,
 *   verify on the API page — limits change). Check the API's own docs
 *   for its exact endpoint/params before subscribing; the app calls it
 *   through the same fetch helpers and normalises whatever formats
 *   array it returns.
 *   Fallback noted in README: "YouTube FAST Downloader" free plan
 *   100 requests / month, 50 MB max file size.
 *
 * Instagram Profile (DP + Bio — the REAL profile data):
 *   Scrappa (NOT RapidAPI — the owner has no card, and RapidAPI
 *   demands a card even for $0 freemium plans).
 *   Endpoint:  GET https://scrappa.co/api/v2/instagram/user?username=<name>
 *   By ID:     GET https://scrappa.co/api/instagram/user/basic?user_id=<id>
 *              (returns username + name + picture; Bio then needs one
 *              more call to the full endpoint with that username)
 *   Auth:      x-api-key header (Scrappa API key, free signup, no card)
 *   Response:  { success, found, user: { id, username, full_name,
 *                biography, profile_pic_url, profile_pic_url_hd,
 *                follower_count, following_count, media_count,
 *                is_private, is_verified } }
 *   Free plan: 500 credits / month, no card, 1 credit per lookup.
 *   NOTE: profile_pic_url_hd was null for the owner's profile in a
 *   live test (2026-11-12) — the picture returned is 150x150, and
 *   Instagram's CDN rejects modified (upscaled) URLs, so DP
 *   Download saves the real picture at 150x150.
 *   The working Instagram /fetch API returns HTTP 400 for profile
 *   URLs, so it cannot be used for DP/Bio. The RapidAPI Instagram
 *   Scraper profile API (50/mo) is NOT used — it needs a card.
 */
const DEFAULT_RAPIDAPI_KEY = 'c109599a7fmshd1709ec3e60efc1p11e3bdjsn79d71c03eb68';

const API_HOSTS = {
  instagram: 'instagram-downloader-download-instagram-videos-stories1.p.rapidapi.com',
  allinone: 'social-media-downloader-api-pro.p.rapidapi.com',
  youtube: 'youtube-downloader24.p.rapidapi.com',
  scrappa: 'scrappa.co'
};

/* Built-in Scrappa API key (owner's own key, added 2026-11-12 at his
   request so DP/Bio work for visitors without a key). Same warning as
   the RapidAPI key above: this repo is PUBLIC — anyone can copy this
   key and every visitor's DP/Bio fetch counts against the owner's
   500 free Scrappa credits/month. Rotate it on Scrappa if abused. */
const DEFAULT_SCRAPPA_KEY = 'eyJpdiI6IndWTWtDK1JiWW5DL2NPL1dGUWRiSHc9PSIsInZhbHVlIjoiV0x1Q3V2UExhV2dIaUlOaURyWndPdGo5ZDN2QVpicWQxT3ZQeXBkK0V5VHV6Q1hpN1dWTWo4aHlqakk4WU94WUV1RTRvVnRkN1pkSVBIQk1EQW9PWEE9PSIsIm1hYyI6IjA0YWZiM2NmMDc0MjZkOTg5MmRjMGExMjE3YmFhM2Y3YzA5OGFhYzk5ZDY3Y2U0NzZhMzY1NzUxZmZkYTYxZjQiLCJ0YWciOiIifQ==';

/**
 * Default monthly quotas (requests / month). These are the FREE-plan
 * figures quoted on RapidAPI at the time of writing — edit them in
 * Settings > Monthly limits if your subscription differs.
 * 1 paste + Fetch = 1 API call = 1 quota use. Downloading the file
 * itself (the direct media URL) does NOT cost an extra API call.
 */
const DEFAULT_LIMITS = {
  instagram: 500,
  youtube: 500,
  facebook: 100,
  allinone: 200, // free Basic plan on RapidAPI: $0/mo, 200 req/mo, hard limit
  ig_profile: 500 // Scrappa free plan: 500 credits/month, no card
};

/** localStorage keys used by the app. */
const STORE = {
  settings: 'vd_settings',        // { rapidapiKey, hosts:{}, limits:{}, appsScriptUrl }
  adminBackend: 'vd_admin_backend', // admin panel's backend URL — the app falls back to it (see loadSettings)
  quota: 'vd_quota',              // { "YYYY-MM": { instagram: n, youtube: n, ... } }
  history: 'vd_history',          // [ { date, time, device, platform, tool, video_url, quality, city, lat, lng, mapsLink } ]
  notifications: 'vd_notifications', // [ { id, type, title, message, time, read, userId } ] — user notifications, per browser
  notifFlags: 'vd_notif_flags',   // { "low:instagram:2026-11": true, ... } — limit warnings sent once per bucket per month
  userId: 'vd_user_id'            // anonymous per-browser ID (the app has no login; this keeps notifications separate per browser)
};

/** Tools shown in the sidebar. `platform` drives quota bucket + logging. */
const TOOLS = {
  dashboard:   { label: 'Dashboard',            platform: null },
  ig_reel:     { label: 'Reel Download',        platform: 'instagram', group: 'Instagram' },
  ig_story:    { label: 'Story Download',       platform: 'instagram', group: 'Instagram' },
  ig_dp:       { label: 'DP Download',          platform: 'instagram', group: 'Instagram' },
  ig_caption:  { label: 'Copy Reel Caption',    platform: 'instagram', group: 'Instagram' },
  ig_bio:      { label: 'Copy Bio',             platform: 'instagram', group: 'Instagram' },
  fb_video:    { label: 'Video Download',       platform: 'facebook',  group: 'Facebook' },
  yt_short:    { label: 'Short Download',       platform: 'youtube',   group: 'YouTube' },
  yt_full:     { label: 'Full Video Download',  platform: 'youtube',   group: 'YouTube' },
  to_song:     { label: 'Video to Song',        platform: 'allinone',  group: 'Converter' }
};

// Expose for app.js (plain <script> files, no modules, so it works from file:// too).
window.VD_CONFIG = { API_HOSTS, DEFAULT_LIMITS, STORE, TOOLS, DEFAULT_RAPIDAPI_KEY, DEFAULT_SCRAPPA_KEY };
