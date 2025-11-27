# Paginated Image Viewer

<p align="center">
  <img src=".github/demo.gif" alt="Gallery Demo" width="600">
</p>

A static gallery generator that creates a standalone, paginated HTML viewer for images and videos. Point it at any folder and get a browsable gallery with thumbnails, keyboard navigation, and a lightbox viewer.

## Features

- **Multi-format support**: Images (JPG, PNG, GIF, WebP, BMP) and videos (MP4)
- **Animated thumbnails**: Videos and GIFs get animated WebP previews
- **Paginated grid**: 15 items per page with keyboard navigation
- **Lightbox viewer**: Full-size viewing with native video controls
- **Lazy loading**: Thumbnails load on demand for fast initial render
- **Thumbnail caching**: Hash-based caching skips regeneration of existing thumbnails
- **Standalone output**: Single HTML file with embedded CSS/JS, no server required
- **Deduplication**: Skips files with identical sizes

## Requirements

- **Node.js** (v14+)
- **ffmpeg** (for video thumbnail generation)

```bash
# macOS
brew install ffmpeg

# Ubuntu/Debian
sudo apt install ffmpeg
```

## Installation

```bash
git clone https://github.com/yourusername/Paginated-image-viewer.git
cd Paginated-image-viewer
npm install
```

## Usage

Run the generator in any directory containing images or videos:

```bash
# From the project directory
node /path/to/generate-gallery.js

# Or copy the script to your media folder
node generate-gallery.js
```

This creates:
- `gallery.html` - Open in any browser to view the gallery
- `images-data.js` - Media metadata
- `thumbnails/` - Cached thumbnail files

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `↑` `↓` `←` `→` | Navigate thumbnails with cursor |
| `Shift` + `←` `→` | Previous/Next page |
| `Enter` | Open selected thumbnail |
| `Escape` | Hide cursor / Close lightbox |
| `←` `→` (in lightbox) | Previous/Next item |
| `Space` (in lightbox) | Pause/unpause video |

### Utilities

```bash
# Delete video thumbnails (to regenerate with new settings)
node delete-video-thumbnails.js
```

## Configuration

Edit constants at the top of `generate-gallery.js`:

```javascript
const IMAGES_PER_PAGE = 15;        // Items per gallery page
const THUMBNAIL_SIZE = 300;         // Thumbnail dimensions (px)
const CONCURRENT_THUMBNAILS = 8;    // Parallel thumbnail generation
const VIDEO_THUMBNAIL_FPS = 15;     // Animated thumbnail playback speed
```

## How It Works

1. **Scan**: Recursively finds all supported media files
2. **Deduplicate**: Skips files with identical sizes
3. **Generate metadata**: Creates `images-data.js` with paths, sizes, and types
4. **Generate HTML**: Creates standalone `gallery.html` with embedded viewer
5. **Create thumbnails**:
   - Images: Resized with Sharp (300x300, cover fit)
   - Videos: Animated WebP created with ffmpeg (7-10 segments of 10-20 frames each)
   - GIFs: Converted to animated WebP for smaller size

Thumbnails are stored in `thumbnails/{hash[0]}/{hash[1]}/{hash}.{ext}` using a deterministic hash of the file path. Existing thumbnails are skipped on subsequent runs.

## License

MIT
