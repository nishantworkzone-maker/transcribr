// routes/importLink.js — Security hardened
// Downloads audio from YouTube links and public URLs
// FIXED: Command injection in yt-dlp call; SSRF protection; input validation

import express from 'express';
import { execFile } from 'child_process';  // execFile, NOT exec — prevents shell injection
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
const execFileAsync = promisify(execFile);

// Max download size: 200MB
const MAX_DOWNLOAD_BYTES = 200 * 1024 * 1024;

// Allowlisted protocols
const ALLOWED_PROTOCOLS = ['https:'];

// Block internal/private IP ranges (SSRF protection)
function isSafeUrl(url) {
  try {
    const parsed = new URL(url);
    const h = parsed.hostname;
    if (!ALLOWED_PROTOCOLS.includes(parsed.protocol)) return false;
    if (
      h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' ||
      h === '169.254.169.254' || h === 'metadata.google.internal' ||
      /^10\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
      /^192\.168\./.test(h)
    ) return false;
    return true;
  } catch { return false; }
}

function isYouTubeUrl(url) {
  try {
    const h = new URL(url).hostname.replace(/^www\./, '');
    return h === 'youtube.com' || h === 'youtu.be';
  } catch { return false; }
}

// Download audio from public URL (non-YouTube) with size limit
async function downloadPublicUrl(url, outputPath) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Transcribr/3.0', 'Accept': 'audio/*,video/*' },
    size: MAX_DOWNLOAD_BYTES,  // node-fetch size limit
  });
  if (!res.ok) throw new Error(`Could not download audio (HTTP ${res.status})`);

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('audio') && !contentType.includes('video') && !contentType.includes('octet-stream')) {
    throw new Error('URL does not point to an audio or video file');
  }

  const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
  if (contentLength > MAX_DOWNLOAD_BYTES) {
    throw new Error('File is too large to import. Maximum size is 200MB.');
  }

  const buffer = await res.arrayBuffer();
  if (buffer.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error('File is too large to import. Maximum size is 200MB.');
  }

  fs.writeFileSync(outputPath, Buffer.from(buffer));
  return outputPath;
}

// Download audio from YouTube using yt-dlp
// SECURITY: Uses execFile (not exec) — args are passed as array, never shell-interpolated
async function downloadYouTube(url, outputPath) {
  // Validate it's actually a YouTube URL before shelling out
  if (!isYouTubeUrl(url)) throw new Error('Not a valid YouTube URL');

  const args = [
    '-x',
    '--audio-format', 'mp3',
    '--audio-quality', '0',
    '--no-playlist',          // never download playlists
    '--max-filesize', '200m', // yt-dlp built-in size cap
    '-o', outputPath,
    '--', url,                // '--' prevents URL from being interpreted as a flag
  ];

  try {
    await execFileAsync('yt-dlp', args, { timeout: 120000 });
    return outputPath;
  } catch (err) {
    // Scrub internal error details from yt-dlp that might reveal server paths
    throw new Error('Could not download audio from YouTube. The video may be private, age-restricted, or unavailable in your region.');
  }
}

// POST /api/import-link
router.post('/', requireAuth, async (req, res) => {
  const { url } = req.body;

  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Please provide a URL' });
  }

  // Strict URL length limit
  if (url.length > 2048) {
    return res.status(400).json({ error: 'URL is too long.' });
  }

  // Validate URL format and safety
  if (!isSafeUrl(url)) {
    return res.status(400).json({ error: 'This URL is not permitted. Only HTTPS public URLs are supported.' });
  }

  const outputPath = `/tmp/import_${Date.now()}_${Math.random().toString(36).slice(2,7)}.mp3`;

  try {
    if (isYouTubeUrl(url)) {
      await downloadYouTube(url, outputPath);
    } else {
      await downloadPublicUrl(url, outputPath);
    }

    if (!fs.existsSync(outputPath)) throw new Error('Download completed but file was not found');
    const stats = fs.statSync(outputPath);
    if (stats.size === 0) throw new Error('Downloaded file is empty');

    res.json({
      success: true,
      filePath: outputPath,
      fileName: path.basename(outputPath),
      sizeBytes: stats.size,
      isYouTube: isYouTubeUrl(url),
    });

  } catch (err) {
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
    res.status(500).json({ error: err.message });
  }
});

export default router;
