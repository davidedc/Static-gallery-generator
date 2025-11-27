#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

// Configuration
const IMAGES_PER_PAGE = 15;
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
const VIDEO_EXTENSIONS = ['.mp4'];
const MEDIA_EXTENSIONS = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS];
const OUTPUT_DATA_FILE = 'images-data.js';
const OUTPUT_HTML_FILE = 'gallery.html';
const THUMBNAILS_DIR = 'thumbnails';
const THUMBNAIL_SIZE = 300;
const CONCURRENT_THUMBNAILS = 8;
const VIDEO_THUMBNAIL_FPS = 15;          // Playback FPS for animated thumbnail

// Get the directory where the script is run from
const ROOT_DIR = process.cwd();

console.log(`Scanning for media in: ${ROOT_DIR}`);

// Track seen file sizes for deduplication
const seenSizes = new Set();
let duplicatesSkipped = 0;

/**
 * Recursively find all media files (images and videos) in a directory
 */
function findMedia(dir, media = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.warn(`Warning: Could not read directory ${dir}: ${err.message}`);
    return media;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    // Skip output files and thumbnails directory
    if (entry.name === OUTPUT_DATA_FILE || entry.name === OUTPUT_HTML_FILE || entry.name === THUMBNAILS_DIR) {
      continue;
    }

    if (entry.isDirectory()) {
      findMedia(fullPath, media);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (MEDIA_EXTENSIONS.includes(ext)) {
        try {
          const stats = fs.statSync(fullPath);

          // Skip duplicates (same file size = likely duplicate)
          if (seenSizes.has(stats.size)) {
            duplicatesSkipped++;
            continue;
          }
          seenSizes.add(stats.size);

          const relativePath = path.relative(ROOT_DIR, fullPath);
          const isVideo = VIDEO_EXTENSIONS.includes(ext);
          media.push({
            path: relativePath,
            size: stats.size,
            type: isVideo ? 'video' : 'image'
          });
        } catch (err) {
          console.warn(`Warning: Could not read ${fullPath}: ${err.message}`);
        }
      }
    }
  }

  return media;
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Hash a string to a 16-character hex string (64-bit)
 * Uses two djb2 hashes combined for better distribution
 */
function hashPath(str) {
  let h1 = 5381, h2 = 52711;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = ((h1 << 5) + h1) ^ c;
    h2 = ((h2 << 5) + h2) ^ c;
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') +
         (h2 >>> 0).toString(16).padStart(8, '0');
}

/**
 * Get thumbnail path for a media file (hash-based with nested directories)
 */
function getThumbnailPath(mediaPath, mediaType) {
  const ext = path.extname(mediaPath).toLowerCase();
  // Videos and GIFs get animated WebP thumbnails
  const thumbExt = (mediaType === 'video' || ext === '.gif') ? '.webp' : (ext === '.png' ? '.png' : '.jpg');
  const hash = hashPath(mediaPath);
  // Structure: thumbnails/{hash[0]}/{hash[1]}/{hash}.{ext}
  return path.join(THUMBNAILS_DIR, hash[0], hash[1], hash + thumbExt);
}

/**
 * Check if ffmpeg is available on the system
 */
function checkFfmpegAvailable() {
  try {
    execSync('ffmpeg -version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get video duration using ffprobe
 */
function getVideoDuration(videoPath) {
  try {
    const result = execSync(
      `ffprobe -v error -show_entries format=duration -of csv=p=0 "${videoPath}"`,
      { encoding: 'utf8', timeout: 10000 }
    );
    const duration = parseFloat(result.trim());
    if (isNaN(duration) || duration <= 0) {
      return null;
    }
    return duration;
  } catch (err) {
    return null;
  }
}

/**
 * Generate animated WebP thumbnail from video using ffmpeg
 * Extracts multiple segments, each with consecutive frames, for smoother animation
 * Parameters are derived from hash for deterministic variation between videos
 */
async function generateVideoThumbnail(videoPath, outputPath) {
  const duration = getVideoDuration(videoPath);
  if (!duration) {
    throw new Error('Could not determine video duration');
  }

  // Use hash to deterministically vary parameters per video (avoids synchronized cuts)
  const hash = hashPath(videoPath);
  const baseSegmentCount = parseInt(hash.slice(0, 2), 16) % 4 + 7;     // 7-10 segments
  const framesPerSegment = parseInt(hash.slice(2, 4), 16) % 11 + 10;   // 10-20 frames per segment

  // Calculate segment timestamps distributed across video (skip first/last 5% to avoid black frames)
  const startOffset = duration * 0.05;
  const endOffset = duration * 0.95;
  const usableDuration = endOffset - startOffset;
  const segmentCount = Math.min(baseSegmentCount, Math.max(1, Math.floor(duration))); // At least 1s apart
  const interval = usableDuration / Math.max(1, segmentCount - 1);

  const segmentTimestamps = [];
  for (let i = 0; i < segmentCount; i++) {
    segmentTimestamps.push(startOffset + (i * interval));
  }

  // Use temp directory for intermediate frames
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-thumb-'));

  try {
    let frameIndex = 0;

    // Extract consecutive frames from each segment
    for (let seg = 0; seg < segmentTimestamps.length; seg++) {
      const timestamp = segmentTimestamps[seg];

      // Extract multiple consecutive frames starting at this timestamp
      for (let f = 0; f < framesPerSegment; f++) {
        const frameTime = timestamp + (f / 30); // Assume ~30fps source, extract frames ~1/30s apart
        const framePath = path.join(tempDir, `frame_${frameIndex.toString().padStart(3, '0')}.png`);

        execSync(
          `ffmpeg -y -ss ${frameTime} -i "${videoPath}" -vframes 1 ` +
          `-vf "scale=${THUMBNAIL_SIZE}:${THUMBNAIL_SIZE}:force_original_aspect_ratio=increase,crop=${THUMBNAIL_SIZE}:${THUMBNAIL_SIZE}" ` +
          `"${framePath}"`,
          { stdio: 'pipe', timeout: 30000 }
        );
        frameIndex++;
      }
    }

    // Combine all frames into animated WebP
    execSync(
      `ffmpeg -y -framerate ${VIDEO_THUMBNAIL_FPS} -i "${tempDir}/frame_%03d.png" ` +
      `-vf "scale=${THUMBNAIL_SIZE}:${THUMBNAIL_SIZE}" -loop 0 -quality 75 "${outputPath}"`,
      { stdio: 'pipe', timeout: 60000 }
    );
  } finally {
    // Cleanup temp directory
    try {
      const frames = fs.readdirSync(tempDir);
      for (const frame of frames) {
        fs.unlinkSync(path.join(tempDir, frame));
      }
      fs.rmdirSync(tempDir);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Generate the images-data.js file
 */
function generateDataFile(media) {
  const imageCount = media.filter(m => m.type === 'image').length;
  const videoCount = media.filter(m => m.type === 'video').length;

  const content = `// Auto-generated by generate-gallery.js
// Total media: ${media.length} (${imageCount} images, ${videoCount} videos)
// Generated: ${new Date().toISOString()}

const IMAGES = ${JSON.stringify(media, null, 2)};

const IMAGES_PER_PAGE = ${IMAGES_PER_PAGE};
`;

  fs.writeFileSync(path.join(ROOT_DIR, OUTPUT_DATA_FILE), content);
  console.log(`Generated ${OUTPUT_DATA_FILE} with ${imageCount} images and ${videoCount} videos`);
}

/**
 * Generate the gallery.html file
 */
function generateHtmlFile() {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Image Gallery</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      color: #eee;
      min-height: 100vh;
    }

    .header {
      background: #16213e;
      padding: 1rem 2rem;
      position: sticky;
      top: 0;
      z-index: 100;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
    }

    .header h1 {
      font-size: 1.5rem;
      font-weight: 500;
    }

    .header-info {
      display: flex;
      gap: 2rem;
      align-items: center;
      flex-wrap: wrap;
    }

    .pagination {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .pagination button {
      background: #0f3460;
      border: none;
      color: #eee;
      padding: 0.5rem 1rem;
      border-radius: 4px;
      cursor: pointer;
      font-size: 1rem;
      transition: background 0.2s;
    }

    .pagination button:hover:not(:disabled) {
      background: #e94560;
    }

    .pagination button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .pagination .page-info {
      padding: 0 1rem;
      min-width: 120px;
      text-align: center;
    }

    .shortcuts {
      font-size: 0.85rem;
      color: #888;
    }

    .shortcuts kbd {
      background: #0f3460;
      padding: 0.2rem 0.5rem;
      border-radius: 3px;
      font-family: monospace;
    }

    .gallery {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
      gap: 1rem;
      padding: 2rem;
    }

    .thumbnail {
      aspect-ratio: 1;
      overflow: hidden;
      border-radius: 8px;
      cursor: pointer;
      position: relative;
      background: #16213e;
      transition: transform 0.2s, box-shadow 0.2s;
    }

    .thumbnail:hover {
      transform: scale(1.02);
      box-shadow: 0 4px 20px rgba(233, 69, 96, 0.3);
    }

    .thumbnail.cursor {
      box-shadow: 0 0 0 6px #e94560;
    }

    .thumbnail img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      transition: opacity 0.3s;
    }

    .thumbnail img.loading {
      opacity: 0;
    }

    .thumbnail .size-badge {
      position: absolute;
      bottom: 0.5rem;
      right: 0.5rem;
      background: rgba(0, 0, 0, 0.7);
      padding: 0.2rem 0.5rem;
      border-radius: 3px;
      font-size: 0.75rem;
    }

    .thumbnail .index-badge {
      position: absolute;
      top: 0.5rem;
      left: 0.5rem;
      background: rgba(233, 69, 96, 0.8);
      padding: 0.2rem 0.5rem;
      border-radius: 3px;
      font-size: 0.75rem;
    }

    .thumbnail .play-indicator {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-size: 3rem;
      color: rgba(255, 255, 255, 0.85);
      text-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);
      pointer-events: none;
      transition: transform 0.2s, color 0.2s;
    }

    .thumbnail:hover .play-indicator {
      transform: translate(-50%, -50%) scale(1.1);
      color: #e94560;
    }

    /* Lightbox */
    .lightbox {
      display: none;
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.95);
      z-index: 1000;
      justify-content: center;
      align-items: center;
    }

    .lightbox.active {
      display: flex;
    }

    .lightbox-content {
      position: relative;
      max-width: 95vw;
      max-height: 95vh;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    .lightbox-content img {
      max-width: 95vw;
      max-height: 85vh;
      object-fit: contain;
    }

    .lightbox-content video {
      max-width: 95vw;
      max-height: 85vh;
      outline: none;
    }

    .lightbox-info {
      margin-top: 1rem;
      text-align: center;
      color: #888;
    }

    .lightbox-info .path {
      font-family: monospace;
      font-size: 0.85rem;
      word-break: break-all;
      max-width: 90vw;
    }

    .lightbox-info .position {
      margin-top: 0.5rem;
      color: #e94560;
    }

    .lightbox-close {
      position: absolute;
      top: 1rem;
      right: 1rem;
      background: none;
      border: none;
      color: #eee;
      font-size: 2rem;
      cursor: pointer;
      z-index: 1001;
      width: 50px;
      height: 50px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      transition: background 0.2s;
    }

    .lightbox-close:hover {
      background: rgba(255, 255, 255, 0.1);
    }

    .lightbox-nav {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      background: rgba(255, 255, 255, 0.1);
      border: none;
      color: #eee;
      font-size: 2rem;
      cursor: pointer;
      padding: 1rem;
      z-index: 1001;
      border-radius: 4px;
      transition: background 0.2s;
    }

    .lightbox-nav:hover {
      background: rgba(233, 69, 96, 0.5);
    }

    .lightbox-nav.prev {
      left: 1rem;
    }

    .lightbox-nav.next {
      right: 1rem;
    }

    .loading-spinner {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 40px;
      height: 40px;
      border: 3px solid #333;
      border-top-color: #e94560;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      to { transform: translate(-50%, -50%) rotate(360deg); }
    }

    .no-images {
      text-align: center;
      padding: 4rem 2rem;
      color: #888;
    }

    @media (max-width: 600px) {
      .header {
        padding: 1rem;
      }

      .gallery {
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: 0.5rem;
        padding: 1rem;
      }

      .shortcuts {
        display: none;
      }
    }
  </style>
</head>
<body>
  <header class="header">
    <h1>Image Gallery</h1>
    <div class="header-info">
      <span id="total-info"></span>
      <div class="pagination">
        <button id="prev-btn" onclick="prevPage()">&larr; Prev</button>
        <span class="page-info" id="page-info"></span>
        <button id="next-btn" onclick="nextPage()">Next &rarr;</button>
      </div>
      <div class="shortcuts">
        <kbd>&larr;</kbd> <kbd>&rarr;</kbd> navigate
      </div>
    </div>
  </header>

  <main class="gallery" id="gallery"></main>

  <div class="lightbox" id="lightbox">
    <button class="lightbox-close" onclick="closeLightbox()">&times;</button>
    <button class="lightbox-nav prev" onclick="lightboxPrev()">&larr;</button>
    <button class="lightbox-nav next" onclick="lightboxNext()">&rarr;</button>
    <div class="lightbox-content">
      <div class="loading-spinner" id="lightbox-spinner"></div>
      <img id="lightbox-img" src="" alt="">
      <video id="lightbox-video" controls style="display: none;">
        Your browser does not support the video tag.
      </video>
      <div class="lightbox-info">
        <div class="path" id="lightbox-path"></div>
        <div class="position" id="lightbox-position"></div>
        <div class="size" id="lightbox-size"></div>
      </div>
    </div>
  </div>

  <script src="images-data.js"></script>
  <script>
    // State
    let currentPage = 0;
    let currentLightboxIndex = -1;
    let lightboxActive = false;
    let cursorIndex = -1;  // -1 = cursor hidden
    let lastCursorPos = 0;  // Remember position within page

    // Calculate total pages
    const totalPages = Math.ceil(IMAGES.length / IMAGES_PER_PAGE);

    // Format bytes
    function formatBytes(bytes) {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // Hash a string to a 16-character hex string (64-bit)
    function hashPath(str) {
      let h1 = 5381, h2 = 52711;
      for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        h1 = ((h1 << 5) + h1) ^ c;
        h2 = ((h2 << 5) + h2) ^ c;
      }
      return (h1 >>> 0).toString(16).padStart(8, '0') +
             (h2 >>> 0).toString(16).padStart(8, '0');
    }

    // Get thumbnail path for a media file (hash-based)
    function getThumbnailPath(mediaPath, mediaType) {
      const ext = mediaPath.slice(mediaPath.lastIndexOf('.')).toLowerCase();
      // Videos and GIFs get animated WebP thumbnails
      const thumbExt = (mediaType === 'video' || ext === '.gif') ? '.webp' : (ext === '.png' ? '.png' : '.jpg');
      const hash = hashPath(mediaPath);
      return 'thumbnails/' + hash[0] + '/' + hash[1] + '/' + hash + thumbExt;
    }

    // Render the gallery for current page
    function renderGallery() {
      const gallery = document.getElementById('gallery');
      const start = currentPage * IMAGES_PER_PAGE;
      const end = Math.min(start + IMAGES_PER_PAGE, IMAGES.length);
      const pageMedia = IMAGES.slice(start, end);

      if (IMAGES.length === 0) {
        gallery.innerHTML = '<div class="no-images"><h2>No media found</h2><p>Run generate-gallery.js in a folder containing images or videos.</p></div>';
        return;
      }

      gallery.innerHTML = pageMedia.map((media, i) => {
        const globalIndex = start + i;
        const thumbPath = getThumbnailPath(media.path, media.type);
        const isVideo = media.type === 'video';
        // Try thumbnail first, fall back to original on error
        return \`
          <div class="thumbnail" onclick="openLightbox(\${globalIndex})">
            <div class="loading-spinner"></div>
            <img
              src="\${encodeURI(thumbPath)}"
              data-original="\${encodeURI(media.path)}"
              data-type="\${media.type}"
              alt="\${media.path}"
              class="loading"
              loading="lazy"
              onload="this.classList.remove('loading'); this.previousElementSibling.style.display='none';"
              onerror="if(this.dataset.type !== 'video' && this.src !== this.dataset.original) { this.src = this.dataset.original; } else { this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>❌</text></svg>'; this.classList.remove('loading'); this.previousElementSibling.style.display='none'; }"
            >
            \${isVideo ? '<div class="play-indicator">&#9658;</div>' : ''}
            <span class="index-badge">#\${globalIndex + 1}</span>
            <span class="size-badge">\${formatBytes(media.size)}</span>
          </div>
        \`;
      }).join('');

      // Update page info
      document.getElementById('page-info').textContent = \`Page \${currentPage + 1} of \${totalPages}\`;

      // Show image/video counts
      const imageCount = IMAGES.filter(m => m.type === 'image').length;
      const videoCount = IMAGES.filter(m => m.type === 'video').length;
      const totalText = videoCount > 0 ? \`\${imageCount} images, \${videoCount} videos\` : \`\${IMAGES.length} images\`;
      document.getElementById('total-info').textContent = totalText;

      // Update button states
      document.getElementById('prev-btn').disabled = currentPage === 0;
      document.getElementById('next-btn').disabled = currentPage >= totalPages - 1;
      updateCursor();
    }

    // Navigation
    function nextPage() {
      if (currentPage < totalPages - 1) {
        currentPage++;
        renderGallery();
        window.scrollTo(0, 0);
      }
    }

    function prevPage() {
      if (currentPage > 0) {
        currentPage--;
        renderGallery();
        window.scrollTo(0, 0);
      }
    }

    // Lightbox - always uses original image
    function openLightbox(index) {
      currentLightboxIndex = index;
      lightboxActive = true;
      updateLightbox();
      document.getElementById('lightbox').classList.add('active');
      document.body.style.overflow = 'hidden';
    }

    function closeLightbox() {
      lightboxActive = false;
      document.getElementById('lightbox').classList.remove('active');
      document.body.style.overflow = '';

      // Stop video playback when closing
      const video = document.getElementById('lightbox-video');
      video.pause();
      video.src = '';
    }

    function updateLightbox() {
      const media = IMAGES[currentLightboxIndex];
      const lightboxImg = document.getElementById('lightbox-img');
      const lightboxVideo = document.getElementById('lightbox-video');
      const spinner = document.getElementById('lightbox-spinner');
      const isVideo = media.type === 'video';

      spinner.style.display = 'block';

      // Hide both initially
      lightboxImg.style.display = 'none';
      lightboxImg.style.opacity = '0';
      lightboxVideo.style.display = 'none';
      lightboxVideo.pause();

      if (isVideo) {
        // Show video player
        lightboxVideo.src = encodeURI(media.path);
        lightboxVideo.style.display = 'block';
        lightboxVideo.play();
        lightboxVideo.onloadeddata = function() {
          spinner.style.display = 'none';
        };
        lightboxVideo.onerror = function() {
          spinner.style.display = 'none';
        };
      } else {
        // Show image
        lightboxImg.style.display = 'block';
        lightboxImg.onload = function() {
          spinner.style.display = 'none';
          lightboxImg.style.opacity = '1';
        };
        lightboxImg.src = encodeURI(media.path);
      }

      document.getElementById('lightbox-path').textContent = media.path;
      document.getElementById('lightbox-position').textContent = \`\${isVideo ? 'Video' : 'Image'} \${currentLightboxIndex + 1} of \${IMAGES.length}\`;
      document.getElementById('lightbox-size').textContent = formatBytes(media.size);
    }

    function lightboxNext() {
      if (currentLightboxIndex < IMAGES.length - 1) {
        currentLightboxIndex++;
        updateLightbox();
      }
    }

    function lightboxPrev() {
      if (currentLightboxIndex > 0) {
        currentLightboxIndex--;
        updateLightbox();
      }
    }

    // Cursor navigation helpers
    function getGridColumns() {
      const items = document.querySelectorAll('.thumbnail');
      if (items.length < 2) return 1;
      const firstTop = items[0].offsetTop;
      for (let i = 1; i < items.length; i++) {
        if (items[i].offsetTop !== firstTop) return i;
      }
      return items.length;
    }

    function updateCursor() {
      document.querySelectorAll('.thumbnail').forEach((el, i) => {
        el.classList.toggle('cursor', currentPage * IMAGES_PER_PAGE + i === cursorIndex);
      });
    }

    function moveCursor(key) {
      const cols = getGridColumns();
      const delta = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[key];
      const next = cursorIndex + delta;
      if (next >= 0 && next < IMAGES.length) {
        cursorIndex = next;
        const targetPage = Math.floor(cursorIndex / IMAGES_PER_PAGE);
        if (targetPage !== currentPage) {
          currentPage = targetPage;
          renderGallery();
          window.scrollTo(0, 0);
        }
        updateCursor();
      }
    }

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (lightboxActive) {
        if (e.key === 'Escape') {
          closeLightbox();
        } else if (e.key === 'ArrowRight') {
          lightboxNext();
        } else if (e.key === 'ArrowLeft') {
          lightboxPrev();
        } else if (e.key === ' ' || e.code === 'Space') {
          e.preventDefault();
          const video = document.getElementById('lightbox-video');
          if (video.style.display !== 'none') {
            if (video.paused) {
              video.play();
            } else {
              video.pause();
            }
          }
        }
      } else {
        if (e.shiftKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
          e.preventDefault();
          const oldPage = currentPage;
          e.key === 'ArrowRight' ? nextPage() : prevPage();
          if (cursorIndex >= 0 && currentPage !== oldPage) {
            const posInPage = cursorIndex % IMAGES_PER_PAGE;
            cursorIndex = Math.min(currentPage * IMAGES_PER_PAGE + posInPage, IMAGES.length - 1);
            updateCursor();
          }
        } else if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
          e.preventDefault();
          if (cursorIndex < 0) {
            cursorIndex = Math.min(currentPage * IMAGES_PER_PAGE + lastCursorPos, IMAGES.length - 1);
            updateCursor();
          } else {
            moveCursor(e.key);
          }
        } else if (e.key === 'Escape' && cursorIndex >= 0) {
          lastCursorPos = cursorIndex % IMAGES_PER_PAGE;
          cursorIndex = -1;
          updateCursor();
        } else if (e.key === 'Enter' && cursorIndex >= 0) {
          openLightbox(cursorIndex);
        }
      }
    });

    // Click outside to close lightbox
    document.getElementById('lightbox').addEventListener('click', (e) => {
      if (e.target.id === 'lightbox') {
        closeLightbox();
      }
    });

    // Initial render
    renderGallery();
  </script>
</body>
</html>
`;

  fs.writeFileSync(path.join(ROOT_DIR, OUTPUT_HTML_FILE), html);
  console.log(`Generated ${OUTPUT_HTML_FILE}`);
}

/**
 * Generate thumbnails progressively
 */
async function generateThumbnails(media) {
  let sharp;
  try {
    sharp = require('sharp');
  } catch (err) {
    console.log('\n  sharp module not found. Install it for thumbnail generation:');
    console.log('   npm install sharp');
    console.log('\nGallery will work without thumbnails (using original files).\n');
    return;
  }

  // Check for videos and ffmpeg availability
  const hasVideos = media.some(m => m.type === 'video');
  const hasFfmpeg = checkFfmpegAvailable();
  if (hasVideos && !hasFfmpeg) {
    console.log('\n  ffmpeg not found. Video thumbnails will be skipped.');
    console.log('Install ffmpeg to enable video thumbnail generation.\n');
  }

  console.log(`\nGenerating thumbnails (${THUMBNAIL_SIZE}px, ${CONCURRENT_THUMBNAILS} concurrent)...`);
  console.log('You can open gallery.html now - it will use originals until thumbnails are ready.\n');

  const startTime = Date.now();
  let completed = 0;
  let skipped = 0;
  let failed = 0;

  // Process media in batches
  const queue = [...media];

  async function processOne() {
    while (queue.length > 0) {
      const item = queue.shift();
      const thumbPath = path.join(ROOT_DIR, getThumbnailPath(item.path, item.type));
      const thumbDir = path.dirname(thumbPath);

      // Skip if thumbnail already exists
      if (fs.existsSync(thumbPath)) {
        skipped++;
        completed++;
        continue;
      }

      // Skip video thumbnails if ffmpeg not available
      if (item.type === 'video' && !hasFfmpeg) {
        skipped++;
        completed++;
        continue;
      }

      // Create thumbnail directory
      if (!fs.existsSync(thumbDir)) {
        fs.mkdirSync(thumbDir, { recursive: true });
      }

      try {
        const inputPath = path.join(ROOT_DIR, item.path);
        const ext = path.extname(item.path).toLowerCase();

        if (item.type === 'video') {
          // Use ffmpeg for video thumbnails
          await generateVideoThumbnail(inputPath, thumbPath);
        } else if (ext === '.gif') {
          // For animated GIFs, preserve animation using WebP (better compression)
          await sharp(inputPath, { animated: true })
            .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: 'cover' })
            .webp({ quality: 75 })
            .toFile(thumbPath);
        } else if (ext === '.png') {
          await sharp(inputPath)
            .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: 'cover' })
            .png({ quality: 80 })
            .toFile(thumbPath);
        } else {
          await sharp(inputPath)
            .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, { fit: 'cover' })
            .jpeg({ quality: 80 })
            .toFile(thumbPath);
        }

        completed++;
      } catch (err) {
        failed++;
        completed++;
        // Don't spam errors, just count them
      }

      // Progress update every 10 items or at the end
      if (completed % 10 === 0 || completed === media.length) {
        const percent = ((completed / media.length) * 100).toFixed(1);
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        const rate = (completed / (Date.now() - startTime) * 1000).toFixed(1);
        const eta = completed > 0 ? (((media.length - completed) / rate)).toFixed(0) : '?';
        process.stdout.write(`\rProgress: ${completed}/${media.length} (${percent}%) | ${rate}/s | ETA: ${eta}s | Skipped: ${skipped} | Failed: ${failed}   `);
      }
    }
  }

  // Run concurrent workers
  const workers = [];
  for (let i = 0; i < CONCURRENT_THUMBNAILS; i++) {
    workers.push(processOne());
  }

  await Promise.all(workers);

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\n\nThumbnails complete! Generated: ${completed - skipped - failed}, Skipped: ${skipped}, Failed: ${failed}`);
  console.log(`Total time: ${totalTime}s`);
}

// Main execution
async function main() {
  console.log('');
  console.log('Searching for media files...');
  const media = findMedia(ROOT_DIR);

  const imageCount = media.filter(m => m.type === 'image').length;
  const videoCount = media.filter(m => m.type === 'video').length;
  console.log(`Found ${media.length} files (${imageCount} images, ${videoCount} videos)`);
  if (duplicatesSkipped > 0) {
    console.log(`Skipped ${duplicatesSkipped} duplicates (same file size)`);
  }

  // Sort by size (descending) - largest first for thumbnail generation priority
  media.sort((a, b) => b.size - a.size);

  if (media.length > 0) {
    console.log(`Largest: ${media[0].path} (${formatBytes(media[0].size)})`);
    console.log(`Smallest: ${media[media.length - 1].path} (${formatBytes(media[media.length - 1].size)})`);
  }

  console.log('');
  generateDataFile(media);
  generateHtmlFile();

  console.log('');
  console.log('Gallery ready! Open gallery.html in your browser.');
  console.log(`Total pages: ${Math.ceil(media.length / IMAGES_PER_PAGE)}`);

  // Start thumbnail generation (progressive - user can browse immediately)
  await generateThumbnails(media);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
