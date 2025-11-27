#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const THUMBNAILS_DIR = 'thumbnails';
const ROOT_DIR = process.cwd();

/**
 * Hash a string to a 16-character hex string (64-bit)
 * Same function as in generate-gallery.js
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
 * Get thumbnail path for a video (always .webp)
 */
function getVideoThumbnailPath(videoPath) {
  const hash = hashPath(videoPath);
  return path.join(THUMBNAILS_DIR, hash[0], hash[1], hash + '.webp');
}

// Load images-data.js
const dataFile = path.join(ROOT_DIR, 'images-data.js');
if (!fs.existsSync(dataFile)) {
  console.error('Error: images-data.js not found. Run generate-gallery.js first.');
  process.exit(1);
}

// Parse the data file to extract IMAGES array
const dataContent = fs.readFileSync(dataFile, 'utf8');
const jsonMatch = dataContent.match(/const IMAGES = (\[[\s\S]*?\]);/);
if (!jsonMatch) {
  console.error('Error: Could not parse images-data.js');
  process.exit(1);
}
const IMAGES = JSON.parse(jsonMatch[1]);

// Find videos and delete their thumbnails
const videos = IMAGES.filter(m => m.type === 'video');
console.log(`Found ${videos.length} videos`);

let deleted = 0;
let notFound = 0;

for (const video of videos) {
  const thumbPath = path.join(ROOT_DIR, getVideoThumbnailPath(video.path));

  if (fs.existsSync(thumbPath)) {
    fs.unlinkSync(thumbPath);
    deleted++;
    console.log(`Deleted: ${thumbPath}`);
  } else {
    notFound++;
  }
}

console.log(`\nDone! Deleted: ${deleted}, Not found: ${notFound}`);
