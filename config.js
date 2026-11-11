/* ==========================================================================
   Video Downloader — config.js
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
 */
const DEFAULT_RAPIDAPI_KEY = 'c109599a7fmshd1709ec3e60efc1p11e3bdjsn79d71c03eb68';

const API_HOSTS = {
  instagram: 'instagram-downloader-download-instagram-videos-stories1.p.rapidapi.com',
  allinone: 'social-media-downloader-api-pro.p.rapidapi.com',
  youtube: 'youtube-downloader24.p.rapidapi.com'
};

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
  allinone: 200 // free Basic plan on RapidAPI: $0/mo, 200 req/mo, hard limit
};

/** localStorage keys used by the app. */
const STORE = {
  settings: 'vd_settings',        // { rapidapiKey, hosts:{}, limits:{}, appsScriptUrl }
  quota: 'vd_quota',              // { "YYYY-MM": { instagram: n, youtube: n, ... } }
  history: 'vd_history'           // [ { date, time, device, platform, tool, video_url, quality, city, lat, lng, mapsLink } ]
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
window.VD_CONFIG = { API_HOSTS, DEFAULT_LIMITS, STORE, TOOLS, DEFAULT_RAPIDAPI_KEY };
