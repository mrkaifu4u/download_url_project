import os
import gspread
from flask import Flask, request, render_template_string, send_file
from yt_dlp import YoutubeDL

# --- Configuration ---

# Initialize the Flask App
app = Flask(__name__)

# Path to your Google Sheets credentials
# MAKE SURE you have 'credentials.json' from Step 1 in the same folder
SERVICE_ACCOUNT_FILE = 'credentials.json'

# The name of your Google Sheet
# MAKE SURE you have shared this sheet with the service account email
GOOGLE_SHEET_NAME = "MyDownloaderLog"

# A folder to temporarily store downloads
# Make sure this folder (e.g., 'temp_downloads') exists!
DOWNLOAD_FOLDER = 'temp_downloads'

# --- Google Sheets Setup ---
try:
    gc = gspread.service_account(filename=SERVICE_ACCOUNT_FILE)
    sh = gc.open(GOOGLE_SHEET_NAME).sheet1
    print("Successfully connected to Google Sheets.")
except Exception as e:
    print(f"Error connecting to Google Sheets: {e}")
    print("Please ensure 'credentials.json' is correct and you shared the sheet.")
    sh = None

# --- Frontend: HTML, CSS & JavaScript ---
# We store the entire frontend in our Python file as a string.
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

        /* --- RESPONSIVE DESIGN FOR MOBILE & TABLET --- */
        @media (max-width: 600px) {
            body {
                align-items: flex-start; /* Align to top on mobile */
                padding-top: 2rem;
            }
            .container {
                padding: 1.5rem;
                box-shadow: none;
            }
            h1 {
                font-size: 1.8rem;
            }
            p {
                font-size: 0.95rem;
                margin-bottom: 1.5rem;
            }
            input[type="url"], button {
                font-size: 1rem;
                padding: 0.9rem;
            }
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

        <!-- Progress Bar Element -->
        <div class="progress-wrapper" id="progress-wrapper">
            <div class="progress-bar-container">
                <div class="progress-bar" id="progress-bar"></div>
            </div>
            <p class="progress-text" id="progress-text">Starting download...</p>
        </div>
        
        <!-- Message from Flask -->
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

            // Show/hide clear button based on input
            urlInput.addEventListener('input', function() {
                if (urlInput.value.length > 0) {
                    clearBtn.style.display = 'block';
                } else {
                    clearBtn.style.display = 'none';
                }
            });

            // Clear button functionality
            clearBtn.addEventListener('click', function() {
                urlInput.value = '';
                urlInput.focus();
                clearBtn.style.display = 'none';
            });
            
            // Handle form submission for progress bar
            form.addEventListener('submit', function(e) {
                // Check if the URL is not empty
                if (!urlInput.value) {
                    return; // Let the browser handle the 'required' validation
                }

                // Show the progress bar
                progressWrapper.style.display = 'block';

                // Simulate progress
                let currentProgress = 0;
                clearInterval(progressInterval); // Clear any existing interval
                
                progressInterval = setInterval(() => {
                    currentProgress += Math.random() * 5; // Increment progress randomly
                    if (currentProgress > 95) {
                        currentProgress = 95; // Don't reach 100% until download starts
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

# --- Backend Routes ---

@app.route('/')
def home():
    """Renders the homepage."""
    return render_template_string(HTML_TEMPLATE)

@app.route('/download', methods=['POST'])
def download_video():
    """Handles the download request from the form."""
    url = request.form['url']
    
    # 1. Log to Google Sheets
    if sh:
        try:
            sh.append_row([url, 'pending', 'N/A'])
            print(f"Logged URL to Google Sheets: {url}")
        except Exception as e:
            print(f"Failed to log to Google Sheets: {e}")

    # 2. Download the video using yt-dlp
    try:
        # === FIX APPLIED HERE ===
        # Changed the format to 'best[ext=mp4]/best'.
        # This asks for the best quality pre-merged MP4 file,
        # avoiding the need for ffmpeg to combine separate video and audio streams.
        ydl_opts = {
            'format': 'best[ext=mp4]/best',
            'outtmpl': os.path.join(DOWNLOAD_FOLDER, 'downloaded_video.%(ext)s'),
            'quiet': True,
        }

        with YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            video_title = info.get('title', 'video')
            file_ext = info.get('ext', 'mp4')
            
            # Create a safe filename
            safe_title = "".join(c for c in video_title if c.isalnum() or c in (' ', '_')).rstrip()
            downloaded_file_path = os.path.join(DOWNLOAD_FOLDER, f'downloaded_video.{file_ext}')
            
            # Create a clean final filename
            final_filename = f"{safe_title}.{file_ext}"
            final_file_path = os.path.join(DOWNLOAD_FOLDER, final_filename)

            # Rename the downloaded file
            if os.path.exists(final_file_path):
                 os.remove(final_file_path)
            os.rename(downloaded_file_path, final_file_path)

            print(f"Successfully downloaded: {final_filename}")

            # 3. Send the file to the user
            response = send_file(final_file_path, as_attachment=True)
            return response

    except Exception as e:
        error_message = str(e).split('ERROR: ')[-1]
        print(f"Error during download: {error_message}")
        return render_template_string(HTML_TEMPLATE, message=f"Error: Could not download the video. Please check the URL and try again.")

# --- Run the App ---
if __name__ == '__main__':
    # Create the download folder if it doesn't exist
    if not os.path.exists(DOWNLOAD_FOLDER):
        os.makedirs(DOWNLOAD_FOLDER)
    
    # Runs the web server
    app.run(debug=True, port=5000)
