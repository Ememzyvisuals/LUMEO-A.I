/**
 * lumeo_music.js — Music Generation (HuggingFace MusicGen)
 * EMEMZYVISUALS DIGITALS | Emmanuel.A
 */
"use strict";

const https = require("https");
const fs    = require("fs");
const path  = require("path");

const TMP = "/tmp";

async function generateMusic(prompt) {
  const tokens = [
    process.env.HF_TOKEN, process.env.HF_TOKEN_2, process.env.HF_TOKEN_3,
  ].map(t => (t || "").trim()).filter(Boolean);

  if (!tokens.length) return { hasAudio: false };

  const model = "facebook/musicgen-stereo-small";
  console.log(`[Music] 🎵 Generating: "${prompt.slice(0, 60)}"`);

  for (const token of tokens) {
    try {
      const body   = JSON.stringify({ inputs: prompt.slice(0, 300) });
      const result = await new Promise((resolve) => {
        const req = https.request({
          hostname: "router.huggingface.co",
          path:     `/hf-inference/models/${model}`,
          method:   "POST",
          headers:  {
            "Authorization":    `Bearer ${token}`,
            "Content-Type":     "application/json",
            "Content-Length":   Buffer.byteLength(body),
            "x-wait-for-model": "true",
          },
          timeout: 120000,
        }, (res) => {
          const chunks = [];
          res.on("data", c => chunks.push(c));
          res.on("end", () => {
            const buf = Buffer.concat(chunks);
            if (res.statusCode === 200 && buf.length > 1000) resolve(buf);
            else resolve(null);
          });
        });
        req.on("error", () => resolve(null));
        req.on("timeout", () => { req.destroy(); resolve(null); });
        req.write(body); req.end();
      });

      if (result) {
        const ts  = Date.now();
        const out = path.join(TMP, `lumeo_music_${ts}.mp3`);
        fs.writeFileSync(out, result);
        console.log(`[Music] ✅ ${(result.length / 1024).toFixed(0)}KB generated`);
        return {
          hasAudio: true, buffer: result,
          title:    prompt.slice(0, 40).replace(/[^a-z0-9 ]/gi, "") || "Lumeo Music",
          cleanup:  () => { try { fs.unlinkSync(out); } catch {} },
        };
      }
    } catch {}
  }

  return { hasAudio: false };
}

module.exports = { generateMusic };
