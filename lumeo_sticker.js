/**
 * lumeo_sticker.js — WhatsApp Sticker Creator
 * EMEMZYVISUALS DIGITALS | Emmanuel.A
 * Converts image/video/GIF to WhatsApp WebP sticker using FFmpeg
 */
"use strict";

const { exec } = require("child_process");
const fs       = require("fs");
const path     = require("path");

const TMP = "/tmp";

async function createSticker(inputBuffer, mimeType = "image/jpeg") {
  const ts      = Date.now();
  const isVideo = mimeType.startsWith("video/");
  const isGif   = mimeType === "image/gif";
  const ext     = isVideo ? "mp4" : isGif ? "gif" : "jpg";
  const inPath  = path.join(TMP, `stk_in_${ts}.${ext}`);
  const outPath = path.join(TMP, `stk_out_${ts}.webp`);

  fs.writeFileSync(inPath, inputBuffer);

  return new Promise((resolve) => {
    let cmd;
    const scale = "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000";

    if (isVideo || isGif) {
      cmd = `ffmpeg -i "${inPath}" -vf "fps=15,${scale}" -vcodec libwebp -lossless 0 -compression_level 6 -q:v 50 -loop 0 -t 5 -preset picture -an -vsync 0 -y "${outPath}" 2>&1`;
    } else {
      cmd = `ffmpeg -i "${inPath}" -vf "${scale}" -vcodec libwebp -lossless 0 -compression_level 6 -q:v 80 -y "${outPath}" 2>&1`;
    }

    exec(cmd, { timeout: 30000 }, (err) => {
      try { fs.unlinkSync(inPath); } catch {}
      if (err || !fs.existsSync(outPath)) {
        console.error("[Sticker] FFmpeg error:", err?.message?.slice(0, 100));
        return resolve(null);
      }
      const buf = fs.readFileSync(outPath);
      try { fs.unlinkSync(outPath); } catch {}
      if (buf.length < 100) return resolve(null);
      console.log(`[Sticker] ✅ ${(buf.length / 1024).toFixed(0)}KB WebP`);
      resolve(buf);
    });
  });
}

module.exports = { createSticker };
