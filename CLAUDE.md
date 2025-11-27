# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A static gallery generator that creates a paginated HTML viewer for images and videos. It scans a directory for media files, generates thumbnails, and outputs a standalone `gallery.html` file.

## Commands

```bash
# Install dependencies
npm install

# Generate gallery (run from any directory containing media)
node generate-gallery.js

# Delete video thumbnails (to force regeneration)
node delete-video-thumbnails.js
```

**External dependency:** `ffmpeg` must be installed for video thumbnail generation.

## Architecture

### File Structure

- `generate-gallery.js` - Main script that:
  - Recursively finds images (.jpg, .jpeg, .png, .gif, .webp, .bmp) and videos (.mp4)
  - Generates `images-data.js` with media metadata (path, size, type)
  - Generates `gallery.html` with embedded CSS/JS (standalone, no external deps)
  - Creates thumbnails in `thumbnails/{hash[0]}/{hash[1]}/{hash}.{ext}`

- `delete-video-thumbnails.js` - Utility to delete video thumbnails for regeneration

### Generated Files

- `gallery.html` - Standalone viewer (open in browser)
- `images-data.js` - Media metadata array
- `thumbnails/` - Hash-based directory structure for cached thumbnails

### Key Implementation Details

**Thumbnail generation:**
- Images: Uses Sharp library (300x300, cover fit)
- Videos: Uses ffmpeg to extract frames, creates animated WebP
- Video thumbnails have deterministic variation (7-10 segments, 10-20 frames each) derived from file hash to prevent synchronized cuts

**Hash function:** djb2 variant producing 16-char hex string, used for:
- Thumbnail file naming
- Deterministic parameter variation for videos

**Deduplication:** Files with identical sizes are skipped (assumes duplicate)

**Frontend (embedded in gallery.html):**
- Vanilla JS, no frameworks
- Paginated grid view with lightbox
- Videos auto-play in lightbox with native controls
- Lazy loading thumbnails with fallback to original
