import os
import base64
import json
import re
import shlex
import subprocess
from pathlib import Path
from datetime import datetime
from flask import Flask, request, render_template_string, send_file, abort

# ---------------------------
# Configuration
# ---------------------------
SERVICE_ACCOUNT_FILE = "credentials.json"
GOOGLE_SHEET_NAME = "MyDownloaderLog"
# Where downloaded files will live (make sure this is writable on Render)
DOWNLOAD_FOLDER = "temp_downloads"
# Cookies file path (Render temp path)
COOKIE_FILE_PATH = "/tmp/cookies.txt"
# Environment variable names (we prefer base64-encoded to avoid paste issues)
COOKIES_B64_ENV = "YTDLP_COOKIES_B64"
COOKIES_RAW_ENV = "YTDLP_COOKIES"  # fallback if user put raw cookies
# Optional proxy
PROXY_ENV = "YTDLP_PROXY"
# yt-dlp timeout (seconds) for each subprocess call
YTDLP_TIMEOUT = 600

# ---------------------------
# Ensure folders
# ---------------------------
Path(DOWNLOAD_FOLDER).mkdir(parents=True, exist_ok=True)

# ---------------------------
# Flask app
# ---------------------------
app = Flask(__name__)

# ---------------------------
# Helper: write cookies file from env (atomic)
# ---------------------------

def write_cookies_file():
    """Write cookies file from environment. Returns True if file exists after call."""
    # Prefer base64-encoded env var to avoid newline issues
    b64 = os.environ.get(COOKIES_B64_ENV)
    raw = os.environ.get(COOKIES_RAW_ENV)

    if not b64 and not raw:
        return os.path.exists(COOKIE_FILE_PATH)

    try:
        if b64:
            data = base64.b64decode(b64)
        else:
            data = raw.encode("utf-8")

        temp_path = COOKIE_FILE_PATH + ".partial"
        with open(temp_path, "wb") as f:
            f.write(data)
        os.replace(temp_path, COOKIE_FILE_PATH)
        os.chmod(COOKIE_FILE_PATH, 0o600)
        app.logger.info("Wrote cookies file to %s", COOKIE_FILE_PATH)
        return True
    except Exception as e:
        app.logger.exception("Failed to write cookies file: %s", e)
        return False

# Attempt to write cookies file on startup
write_cookies_file()

# ---------------------------
# Google Sheets setup (best-effort)
# ---------------------------
try:
    import gspread
    gc = gspread.service_account(filename=SERVICE_ACCOUNT_FILE)
    sh = gc.open(GOOGLE_SHEET_NAME).sheet1
    app.logger.info("Connected to Google Sheets: %s", GOOGLE_SHEET_NAME)
except Exception as e:
    sh = None
    app.logger.warning("Google Sheets unavailable: %s", e)

# ---------------------------
# HTML template (unchanged layout trimmed for brevity)
# ---------------------------
HTML_TEMPLATE = """<html><head><meta name=viewport content='width=device-width,initial-scale=1'>
<title>Downloader</title></head><body>
<div style='max-width:640px;margin:2rem auto;font-family:system-ui,Segoe UI,Roboto;'>
<h1>Universal Downloader</h1>
<form method='POST' action='/download'>
<input name='url' type='url' placeholder='https://...' required style='width:100%;padding:0.8rem;margin-bottom:.6rem'>
<button type='submit' style='padding:.8rem 1.2rem'>Download</button>
</form>
{% if message %}<p style='color:{{ color }}'>{{ message }}</p>{% endif %}
</div></body></html>"""

# ---------------------------
# Utilities
# ---------------------------

def sanitize_filename(name: str, maxlen: int = 200) -> str:
    """Create a safe filename from title. Keeps alphanumerics, spaces, -, _ and trims length."""
    name = name.strip()
    # replace path separators and other problematic chars
    name = re.sub(r"[\\/]+", " ", name)
    # keep common safe chars
    name = re.sub(r"[^A-Za-z0-9 \-_.()\[\]]+", "", name)
    if len(name) > maxlen:
        name = name[:maxlen].rstrip()
    if not name:
        name = "video"
    return name


def log_to_google_sheets(url, source, title_or_error, is_error=False):
    if not sh:
        app.logger.info("Skipping Google Sheets log: sheet not configured")
        return
    try:
        all_values = sh.get_all_values()
        next_sr_no = len(all_values) + 1
        date_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        row_to_add = [next_sr_no, date_str, url, source, title_or_error]
        sh.append_row(row_to_add)
        app.logger.info("Logged to Google Sheets: %s", url)
    except Exception as e:
        app.logger.exception("Failed to log to Google Sheets: %s", e)


def run_yt_dlp_get_info(url: str):
    """Run yt-dlp to fetch metadata as JSON (no download). Returns dict or raises."""
    cmd = [
        "yt-dlp",
        "--print-json",
        "--skip-download",
        "--no-warnings",
    ]
    if os.path.exists(COOKIE_FILE_PATH):
        cmd += ["--cookies", COOKIE_FILE_PATH]
    # add a friendly user agent so it's less likely to be blocked
    cmd += ["--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36"]

    proc = subprocess.run(cmd + [url], capture_output=True, text=True, timeout=YTDLP_TIMEOUT)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr or proc.stdout or f"yt-dlp failed with code {proc.returncode}")
    return json.loads(proc.stdout)


def run_yt_dlp_download(url: str, outpath: str, proxy: str | None = None):
    """Run yt-dlp to download to outpath. Returns (stdout, stderr) or raises."""
    # Use format selection to prefer mp4 if available, otherwise best
    cmd = [
        "yt-dlp",
        "--format", "best[ext=mp4]/best",
        "--no-warnings",
        "--no-call-home",
        "--fragment-retries", "5",
        "--retries", "10",
        "--sleep-interval", "5",
        "--sleep-requests", "3",
        "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36",
        "-o", outpath,
    ]
    if os.path.exists(COOKIE_FILE_PATH):
        cmd += ["--cookies", COOKIE_FILE_PATH]
    if proxy:
        cmd += ["--proxy", proxy]

    # Run and capture
    proc = subprocess.run(cmd + [url], capture_output=True, text=True, timeout=YTDLP_TIMEOUT)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr or proc.stdout or f"yt-dlp failed with code {proc.returncode}")
    return proc.stdout, proc.stderr

# ---------------------------
# Routes
# ---------------------------

@app.route('/')
def home():
    return render_template_string(HTML_TEMPLATE)


@app.route('/download', methods=['POST'])
def download_video():
    url = request.form.get('url')
    if not url:
        return render_template_string(HTML_TEMPLATE, message="No URL provided.", color='red')

    # Refresh cookies file from environment each request (safe, cheap)
    write_cookies_file()

    try:
        info = run_yt_dlp_get_info(url)
    except Exception as e:
        cleaned = str(e).split('ERROR:')[-1].strip()
        app.logger.warning("Metadata fetch failed for %s: %s", url, cleaned)
        log_to_google_sheets(url, "Unknown", cleaned, is_error=True)
        return render_template_string(HTML_TEMPLATE, message=f"Error fetching video info: {cleaned}", color='red')

    # Extract useful fields
    title = info.get('title') or info.get('uploader') or 'video'
    extractor = info.get('extractor') or info.get('extractor_key') or 'Unknown'
    ext = info.get('ext') or 'mp4'

    safe_title = sanitize_filename(title)
    filename = f"{safe_title}.{ext}"
    final_path = os.path.join(DOWNLOAD_FOLDER, filename)

    # Build outpath for yt-dlp (it expects templates). We want to write directly to final_path.
    # To avoid yt-dlp appending stuff, set -o to the exact path using the "%(ext)s" template only if needed.
    out_template = final_path

    proxy = os.environ.get(PROXY_ENV)

    try:
        app.logger.info("Starting download for %s -> %s", url, final_path)
        stdout, stderr = run_yt_dlp_download(url, out_template, proxy)

        # Verify file exists
        if not os.path.exists(final_path):
            raise RuntimeError("Download finished but output file not found")

        log_to_google_sheets(url, extractor, title, is_error=False)
        app.logger.info("Download succeeded: %s", final_path)

        # Return the file as attachment
        return send_file(final_path, as_attachment=True)

    except Exception as e:
        cleaned = str(e).split('ERROR:')[-1].strip()
        app.logger.exception("Download failed for %s: %s", url, cleaned)
        log_to_google_sheets(url, extractor if 'extractor' in locals() else 'Unknown', cleaned, is_error=True)
        # Helpful message for common issues
        msg = "Could not download the video."
        if 'Sign in to confirm' in cleaned or 'sign in to confirm' in cleaned.lower():
            msg += " This video appears to require a logged-in YouTube account — ensure you set the YTDLP_COOKIES_B64 (base64 of cookies.txt) or YTDLP_COOKIES env var."
        elif '429' in cleaned or 'Too Many Requests' in cleaned:
            msg += " The host is rate-limiting requests (HTTP 429). Try reducing concurrency, adding a proxy, or increasing sleep-interval."
        return render_template_string(HTML_TEMPLATE, message=msg, color='red')


# ---------------------------
# Run (local only)
# ---------------------------
if __name__ == '__main__':
    # debug mode for local development only
    app.run(host='0.0.0.0', port=5000, debug=True)
