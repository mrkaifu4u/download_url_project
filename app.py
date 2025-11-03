import os
import gspread
import subprocess
import shlex
import json
from flask import Flask, request, render_template_string, send_file
from datetime import datetime

# --- Configuration ---

# Initialize the Flask App
app = Flask(__name__)

# Path to your Google Sheets credentials
SERVICE_ACCOUNT_FILE = 'credentials.json'
GOOGLE_SHEET_NAME = "MyDownloaderLog"

# A folder to temporarily store downloads
DOWNLOAD_FOLDER = 'temp_downloads'
# Path for the cookies file that will be created from the environment variable
COOKIE_FILE_PATH = '/tmp/cookies.txt'

# --- RENDER DEPLOYMENT: Write cookies from environment variable to a file ---
# This block runs once when the application starts.
# It reads the YTDLP_COOKIES secret you set on Render and writes it to a file.
cookies_env_var = os.environ.get("YTDLP_COOKIES")
if cookies_env_var:
    try:
        with open(COOKIE_FILE_PATH, "w", encoding="utf-8") as f:
            f.write(cookies_env_var)
        print("Successfully created cookies file from environment variable.")
    except Exception as e:
        print(f"Error creating cookies file: {e}")

# --- Google Sheets Setup ---
try:
    gc = gspread.service_account(filename=SERVICE_ACCOUNT_FILE)
    sh = gc.open(GOOGLE_SHEET_NAME).sheet1
    print("Successfully connected to Google Sheets.")
except Exception as e:
    print(f"Error connecting to Google Sheets: {e}")
    print("Please ensure 'credentials.json' is correct and you shared the sheet.")
    sh = None

# --- Frontend: HTML, CSS & JavaScript (No changes needed here) ---
HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Universal Video Downloader</title>
    <style>
        /* General Styling */
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            background-color: #f4f7f6;
            color: #333;
            margin: 0;
            padding: 1rem;
            box-sizing: border-box;
        }

        /* Container & Entry Animation */
        .container {
            background: #ffffff;
            padding: 2.5rem;
            border-radius: 16px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.07);
            width: 100%;
            max-width: 500px;
            text-align: center;
            box-sizing: border-box;
            /* Entry animation */
            animation: fadeInSlideUp 0.8s ease-out forwards;
            opacity: 0;
            transform: translateY(30px);
        }

        @keyframes fadeInSlideUp {
            from {
                opacity: 0;
                transform: translateY(30px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        h1 {
            color: #1a1a1a;
            margin-bottom: 0.5rem;
        }

        p {
            color: #555;
            margin-bottom: 2rem;
        }

        form {
            display: flex;
            flex-direction: column;
            gap: 1.2rem;
        }

        /* URL Input with Clear Button */
        .input-wrapper {
            position: relative;
            display: flex;
            align-items: center;
        }

        input[type="url"] {
            padding: 1rem;
            font-size: 1rem;
            border: 1px solid #ddd;
            border-radius: 8px;
            box-shadow: inset 0 1px 3px rgba(0,0,0,0.04);
            width: 100%;
            padding-right: 2.5rem; /* Space for the clear button */
            transition: border-color 0.3s ease, box-shadow 0.3s ease;
        }

        input[type="url"]:focus {
            outline: none;
            border-color: #0076ff;
            box-shadow: 0 0 0 4px rgba(0, 118, 255, 0.1);
        }

        .clear-url {
            position: absolute;
            right: 1rem;
            top: 50%;
            transform: translateY(-50%);
            cursor: pointer;
            color: #999;
            font-weight: bold;
            font-size: 1.2rem;
            display: none; /* Hidden by default */
            transition: color 0.3s ease;
        }
        
        .clear-url:hover {
            color: #333;
        }

        /* Download Button */
        button {
            padding: 1rem;
            font-size: 1.1rem;
            font-weight: 600;
            color: #fff;
            background: linear-gradient(90deg, #0076ff, #00c6ff);
            border: none;
            border-radius: 8px;
            cursor: pointer;
            transition: all 0.3s ease;
            box-shadow: 0 4px 15px rgba(0, 150, 255, 0.2);
        }

        button:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 20px rgba(0, 150, 255, 0.3);
        }
        
        button:active {
            transform: translateY(0);
            box-shadow: 0 4px 15px rgba(0, 150, 255, 0.2);
        }

        /* Message Styling */
        .message {
            margin-top: 1.5rem;
            font-size: 0.9rem;
            word-wrap: break-word;
        }

        .message.success {
            color: green;
        }

        .message.error {
            color: red;
        }

        /* Progress Bar Styling */
        .progress-wrapper {
            display: none; /* Hidden by default */
            margin-top: 1.5rem;
            text-align: left;
        }
        .progress-bar-container {
            width: 100%;
            background-color: #e0e0e0;
            border-radius: 8px;
            overflow: hidden;
        }
        .progress-bar {
            width: 0%;
            height: 12px;
            background: linear-gradient(90deg, #0076ff, #00c6ff);
            border-radius: 8px;
            transition: width 0.4s ease-in-out;
        }
        .progress-text {
            margin-top: 0.5rem;
            font-size: 0.9rem;
            color: #555;
            text-align: center;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Downloader</h1>
        <p>Paste a video URL to download. (YouTube, Instagram, Facebook, etc.)</p>
        
        <form id="download-form" action="/download" method="POST">
            <div class="input-wrapper">
                <input type="url" id="url-input" name="url" placeholder="https://www.youtube.com/watch?v=..." required>
                <span class="clear-url" id="clear-btn">&times;</span>
            </div>
            <button type="submit">Download</button>
        </form>

        <div class="progress-wrapper" id="progress-wrapper">
            <div class="progress-bar-container">
                <div class="progress-bar" id="progress-bar"></div>
            </div>
            <p class="progress-text" id="progress-text">Starting download...</p>
        </div>
        
        {% if message %}
            <p class="message {{ 'success' if 'Successfully' in message else 'error' }}">{{ message }}</p>
        {% endif %}
    </div>

    <script>
        document.addEventListener('DOMContentLoaded', function() {
            const form = document.getElementById('download-form');
            const urlInput = document.getElementById('url-input');
            const clearBtn = document.getElementById('clear-btn');
            const progressWrapper = document.getElementById('progress-wrapper');
            const progressBar = document.getElementById('progress-bar');
            const progressText = document.getElementById('progress-text');
            let progressInterval;

            urlInput.addEventListener('input', function() {
                clearBtn.style.display = urlInput.value.length > 0 ? 'block' : 'none';
            });

            clearBtn.addEventListener('click', function() {
                urlInput.value = '';
                urlInput.focus();
                clearBtn.style.display = 'none';
            });
            
            form.addEventListener('submit', function(e) {
                if (!urlInput.value) return;

                progressWrapper.style.display = 'block';
                let currentProgress = 0;
                clearInterval(progressInterval);
                
                progressInterval = setInterval(() => {
                    currentProgress += Math.random() * 5;
                    if (currentProgress > 95) {
                        currentProgress = 95;
                        clearInterval(progressInterval);
                    }
                    progressBar.style.width = currentProgress + '%';
                    progressText.innerText = 'Preparing download... ' + Math.round(currentProgress) + '%';
                }, 200);
            });
        });
    </script>
</body>
</html>
"""

# --- Helper function to log to Google Sheets ---
def log_to_google_sheets(url, source, title_or_error, is_error=False):
    """Logs a download attempt (success or failure) to the configured Google Sheet."""
    if not sh:
        print("Skipping Google Sheets log: connection not available.")
        return

    try:
        all_values = sh.get_all_values()
        next_sr_no = len(all_values)
        date_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        row_to_add = [
            next_sr_no,
            date_str,
            url,
            source,
            title_or_error
        ]
        
        sh.append_row(row_to_add)
        status = "ERROR" if is_error else "SUCCESS"
        print(f"Logged {status} to Google Sheets for URL: {url}")
    except Exception as e:
        print(f"Failed to log to Google Sheets: {e}")

# --- Backend Routes ---

@app.route('/')
def home():
    """Renders the homepage."""
    return render_template_string(HTML_TEMPLATE)

# === FULLY REWRITTEN DOWNLOAD FUNCTION USING SUBPROCESS ===
@app.route('/download', methods=['POST'])
def download_video():
    """Handles the download request using a robust subprocess call to yt-dlp."""
    url = request.form['url']

    try:
        # --- Step 1: Get video metadata (title, etc.) using yt-dlp without downloading ---
        info_cmd = ["yt-dlp", "--print-json", "--skip-download", url]
        
        # Add cookies to the info command as well, as they might be needed to access metadata
        if os.path.exists(COOKIE_FILE_PATH):
            info_cmd.extend(["--cookies", COOKIE_FILE_PATH])

        info_process = subprocess.run(info_cmd, capture_output=True, text=True, check=True)
        info = json.loads(info_process.stdout)
        
        video_title = info.get('title', 'video')
        file_ext = info.get('ext', 'mp4')
        source_extractor = info.get('extractor_key', 'Unknown')

        # --- Step 2: Prepare the final filename and build the download command ---
        safe_title = "".join(c for c in video_title if c.isalnum() or c in (' ', '_')).rstrip()
        final_filename = f"{safe_title}.{file_ext}"
        final_file_path = os.path.join(DOWNLOAD_FOLDER, final_filename)

        # Base download command
        download_cmd = [
            "yt-dlp",
            "--format", "best[ext=mp4]/best",
            "--user-agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0 Safari/537.36",
            "--retries", "10",
            "--sleep-interval", "5",
            "--sleep-requests", "3",
            "-o", final_file_path,  # Specify the output file path directly
            url
        ]

        # Add cookies if the file exists
        if os.path.exists(COOKIE_FILE_PATH):
            download_cmd.extend(["--cookies", COOKIE_FILE_PATH])
        
        # Add proxy if defined in environment variables
        proxy = os.environ.get("YTDLP_PROXY")
        if proxy:
            download_cmd.extend(["--proxy", proxy])
            print(f"Using proxy: {proxy}")

        # --- Step 3: Execute the download ---
        print(f"Executing download command: {' '.join(shlex.quote(c) for c in download_cmd)}")
        download_process = subprocess.run(download_cmd, capture_output=True, text=True)

        # --- Step 4: Handle the result ---
        if download_process.returncode != 0:
            # The download failed, raise an exception with the error message from yt-dlp
            raise RuntimeError(download_process.stderr)

        # --- Success Case ---
        print(f"Successfully downloaded: {final_filename}")
        log_to_google_sheets(url, source_extractor, video_title, is_error=False)
        
        # Send the file to the user
        return send_file(final_file_path, as_attachment=True)

    except (subprocess.CalledProcessError, RuntimeError, json.JSONDecodeError) as e:
        # This block catches errors from both the metadata fetch and the download process
        error_output = str(e)
        if hasattr(e, 'stderr') and e.stderr: # If it's a subprocess error
            error_output = e.stderr
        
        # Clean up the common "ERROR:" prefix from yt-dlp for cleaner logging
        cleaned_error = error_output.split('ERROR: ')[-1].strip()
        print(f"Download failed: {cleaned_error}")
        
        # Log the failure to Google Sheets
        log_to_google_sheets(url, "Unknown", cleaned_error, is_error=True)
        
        # Show an error message to the user
        return render_template_string(HTML_TEMPLATE, message="Error: Could not download the video. Please check the URL or try again later.")

# --- Run the App ---
if __name__ == '__main__':
    # Create the download folder if it doesn't exist
    if not os.path.exists(DOWNLOAD_FOLDER):
        os.makedirs(DOWNLOAD_FOLDER)
    
    # Run the web server (for local testing). Gunicorn will handle this on Render.
    app.run(debug=True, port=5000)
