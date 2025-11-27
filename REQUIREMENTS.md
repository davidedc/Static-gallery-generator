# Paginated Image Viewer — Requirements Specification

## 1. Media Support

### 1.1 Supported Formats
- **Images**: JPG, JPEG, PNG, GIF, WebP, BMP
- **Videos**: MP4

### 1.2 File Discovery
- Recursively scan all subdirectories for media files
- Skip output files (`gallery.html`, `images-data.js`) during scanning
- Skip the `thumbnails/` directory during scanning
- Warn but continue if a directory cannot be read

### 1.3 Deduplication
- Files with identical byte sizes are considered duplicates
- Only the first occurrence is included; subsequent duplicates are skipped
- Report count of skipped duplicates

---

## 2. Thumbnail Generation

### 2.1 Caching
- Thumbnails are stored in a hash-based nested structure: `thumbnails/{hash[0]}/{hash[1]}/{hash}.{ext}`
- Hash is a deterministic 16-character hex string derived from the file path (dual djb2)
- If a thumbnail already exists, skip regeneration

### 2.2 Image Thumbnails
- Generated using Sharp library
- Size: 300×300 pixels, cover fit
- Format: Same as source (PNG stays PNG, others become JPG)

### 2.3 Video Thumbnails
- Generated using ffmpeg
- Output: Animated WebP
- Structure: 7-10 segments × 10-20 consecutive frames per segment
- Segment/frame counts derived deterministically from file hash (avoids synchronized "cuts" across thumbnails)
- Skip first/last 5% of video duration to avoid black frames
- Playback FPS: 15

### 2.4 GIF Thumbnails
- Converted to animated WebP for smaller size
- Animation preserved

### 2.5 Generation Process
- Concurrent processing: 8 thumbnails at a time
- Progress reporting: count, percentage, rate, ETA, skipped, failed
- Gallery is usable immediately; originals shown until thumbnails ready

### 2.6 Fallback Behavior
- If thumbnail fails to load for images: fall back to original file
- If thumbnail fails to load for videos: show error icon (❌), do NOT attempt to load video in img tag (prevents browser hang)

---

## 3. Gallery Layout

### 3.1 Viewport Filling
- Gallery grid fills the entire viewport height (minus header)
- No scrolling required — all thumbnails fit on screen
- `overflow: hidden` on body and gallery

### 3.2 Size Presets
- **S (Small)**: ~130px base size — more thumbnails
- **M (Medium)**: ~200px base size — balanced (default)
- **L (Large)**: ~300px base size — fewer, bigger thumbnails

### 3.3 Dynamic Layout Calculation
- Number of columns = `floor((viewportWidth + gap) / (baseSize + gap))`
- Number of rows = `floor((viewportHeight - headerHeight + gap) / (baseSize + gap))`
- Items per page = columns × rows
- Layout recalculates on window resize and size preset change

### 3.4 Grid Properties
- CSS Grid with `1fr` units for even distribution
- Gap: 1rem (16px)
- Padding: 1rem

---

## 4. Pagination

### 4.1 Page Navigation
- Previous/Next buttons in header
- Buttons disabled at first/last page
- Page info displayed: "Page X of Y"
- Total counts displayed: "N images, M videos"

### 4.2 Keyboard Page Navigation
- `Shift+←` / `Shift+→`: Previous/next page directly

---

## 5. Lightbox

### 5.1 Opening
- Click on any thumbnail to open lightbox
- Press `Enter` when cursor is on a thumbnail

### 5.2 Display
- Full-size image or video (max 95vw × 85vh)
- Loading spinner while content loads
- Shows: file path, position ("Image X of Y" or "Video X of Y"), file size

### 5.3 Image Behavior
- Displays at full resolution
- Fade-in on load

### 5.4 Video Behavior
- Native browser video controls displayed
- Auto-play when opened
- Stops playback when lightbox closes

### 5.5 Navigation in Lightbox
- `←` / `→`: Previous/next item
- `Escape`: Close lightbox
- `Space`: Pause/unpause video (only when video is visible)
- Click outside content: Close lightbox

---

## 6. Cursor Navigation

### 6.1 Cursor Activation
- First press of any arrow key shows cursor on current page
- Cursor appears at last remembered position (not always first item)
- Cursor is NOT visible by default

### 6.2 Cursor Appearance
- 6px solid reddish border (`#e94560`) around selected thumbnail
- Uses CSS `box-shadow: 0 0 0 6px #e94560`

### 6.3 Movement
- Arrow keys provide 2D grid-aware navigation:
  - `←` / `→`: Move left/right (±1 item)
  - `↑` / `↓`: Move up/down by row (±columns count)
- Grid column count detected dynamically by comparing thumbnail `offsetTop`

### 6.4 Page Crossing
- Moving cursor past page boundary automatically changes page
- Cursor remains visible on new page

### 6.5 Hiding Cursor
- `Escape` hides cursor (when not in lightbox)
- Remembers relative position within page (`lastCursorPos`)

### 6.6 Reactivation
- When cursor reactivates, appears at remembered position on CURRENT page
- User can navigate to different page, press arrow → cursor appears at same relative position

### 6.7 Shift+Arrow Behavior
- `Shift+←` / `Shift+→` changes page directly
- If cursor was visible, it moves to positionally equivalent thumbnail on new page
- Position calculated as: same index within page (modulo items per page)

### 6.8 Size Change Behavior (S/M/L)
- When INCREASING thumbnail size (fewer items per page):
  - Cursor moves to proportionally equivalent position in new grid
  - Ratio-based: if cursor was at 75% across and 80% down, it stays at ~75%/80% in new grid
- When DECREASING thumbnail size (more items per page):
  - No special repositioning needed

### 6.9 Click Synchronization
- When user clicks a thumbnail to open lightbox:
  - If cursor was already visible: move cursor to clicked thumbnail
  - If cursor was not visible: do NOT make cursor visible

---

## 7. Keyboard Shortcuts Summary

| Key | Context | Action |
|-----|---------|--------|
| `↑` `↓` `←` `→` | Gallery | Navigate cursor (show if hidden) |
| `Shift+←` `Shift+→` | Gallery | Previous/next page |
| `S` / `M` / `L` | Gallery | Set thumbnail size preset |
| `Enter` | Gallery (cursor visible) | Open selected in lightbox |
| `Escape` | Gallery (cursor visible) | Hide cursor |
| `←` `→` | Lightbox | Previous/next item |
| `Escape` | Lightbox | Close lightbox |
| `Space` | Lightbox (video) | Pause/unpause video |

---

## 8. Resize Handling

### 8.1 Window Resize
- Layout recalculates with 100ms debounce
- Current viewing position preserved (same items stay visible)
- Page number adjusted to keep first visible item on screen

### 8.2 Cursor Preservation on Resize
- If increasing size: proportional repositioning (see 6.8)
- If decreasing size: cursor index unchanged

---

## 9. Output Files

### 9.1 gallery.html
- Standalone HTML file with embedded CSS and JavaScript
- References `images-data.js` for media metadata
- No server required — opens directly in browser

### 9.2 images-data.js
- Contains `IMAGES` array with objects: `{ path, size, type }`
- Auto-generated header with counts and timestamp

### 9.3 thumbnails/
- Nested directory structure for cached thumbnails
- Can be deleted and regenerated

---

## 10. Utilities

### 10.1 delete-video-thumbnails.js
- Reads `images-data.js` to find video entries
- Deletes only video thumbnails (`.webp` files)
- Useful for regenerating video thumbnails with different settings
- Reports deleted count and not-found count

---

## 11. Configuration Constants

| Constant | Default | Description |
|----------|---------|-------------|
| `IMAGES_PER_PAGE` | 15 | Base items per page (now dynamic) |
| `THUMBNAIL_SIZE` | 300 | Thumbnail dimensions in pixels |
| `CONCURRENT_THUMBNAILS` | 8 | Parallel thumbnail generation |
| `VIDEO_THUMBNAIL_FPS` | 15 | Animated thumbnail playback speed |
| `SIZE_PRESETS.S` | 130 | Small preset base size |
| `SIZE_PRESETS.M` | 200 | Medium preset base size |
| `SIZE_PRESETS.L` | 300 | Large preset base size |

---

## 12. Visual Design

### 12.1 Color Scheme
- Background: `#1a1a2e` (dark blue)
- Header: `#16213e` (darker blue)
- Accent: `#e94560` (pinkish red)
- Text: `#eee` (light gray)
- Muted text: `#888`

### 12.2 Thumbnail Appearance
- Square aspect ratio (1:1)
- 8px border radius
- Hover: slight scale (1.02) + shadow
- Loading: spinner overlay, image hidden until loaded
- Video indicator: play triangle overlay (▶)
- Badges: index (#N) top-left, size (KB/MB) bottom-right

### 12.3 Lightbox
- Dark overlay (95% opacity black)
- Centered content
- Close button (×) top-right
- Navigation arrows left/right
