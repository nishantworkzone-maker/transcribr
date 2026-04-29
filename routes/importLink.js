// routes/importLink.js
// Downloads audio from YouTube links and public URLs
// Uses yt-dlp for YouTube, ffmpeg for conversion

import express from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();
const execAsync = promisify(exec);

// Check if a URL is a YouTube link
function isYouTubeUrl(url) {
  return /youtube\.com|youtu\.be/i.test(url);
}

// Download audio from a public URL (non-YouTube)
async function downloadPublicUrl(url, outputPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not download from URL: ${res.statusText}`);

  const contentType = res.headers.get('content-type') || '';
  const isAudio = contentType.includes('audio') || contentType.includes('video') || contentType.includes('octet-stream');
  if (!isAudio) throw new Error('URL does not appear to point to an audio or video file');

  const buffer = await res.arrayBuffer();
  fs.writeFileSync(outputPath, Buffer.from(buffer));
  return outputPath;
}

// Download audio from YouTube using yt-dlp
async function downloadYouTube(url, outputPath) {
  // yt-dlp extracts audio and saves as mp3
  const cmd = `yt-dlp -x --audio-format mp3 --audio-quality 0 -o "${outputPath}" "${url}"`;

  try {
    await execAsync(cmd, { timeout: 120000 }); // 2 minute timeout
    return outputPath;
  } catch (err) {
    throw new Error(`yt-dlp failed. Make sure yt-dlp is installed. Error: ${err.message}`);
  }
}

// POST /api/import-link
router.post('/', requireAuth, async (req, res) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'Please provide a URL' });
  }

  // Basic URL validation
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL format' });
  }

  const outputPath = `/tmp/import_${Date.now()}.mp3`;

  try {
    if (isYouTubeUrl(url)) {
      await downloadYouTube(url, outputPath);
    } else {
      await downloadPublicUrl(url, outputPath);
    }

    if (!fs.existsSync(outputPath)) {
      throw new Error('Download completed but file was not found');
    }

    const stats = fs.statSync(outputPath);
    if (stats.size === 0) {
      throw new Error('Downloaded file is empty');
    }

    // Return the local file path so the transcription route can use it
    res.json({
      success: true,
      filePath: outputPath,
      fileName: path.basename(outputPath),
      sizeBytes: stats.size,
      isYouTube: isYouTubeUrl(url)
    });

  } catch (err) {
    // Clean up on error
    if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);

    console.error('Import link error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

export default router;
