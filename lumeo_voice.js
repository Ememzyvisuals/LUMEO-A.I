/**
 * lumeo_voice.js — Voice Note Generation (TTS)
 * EMEMZYVISUALS DIGITALS | Emmanuel.A
 * Uses HuggingFace Orpheus / MMS-TTS → OGG/MP3
 */
"use strict";

const https = require("https");
const fs    = require("fs");
const path  = require("path");

const TMP = "/tmp";

async function generateVoice(text) {
  const tokens = [
    process.env.HF_TOKEN, process.env.HF_TOKEN_2, process.env.HF_TOKEN_3,
  ].map(t => (t || "").trim()).filter(Boolean);

  if (!tokens.length || !text) return { success: false };

  const model = "facebook/mms-tts-eng";
  const clean = text.replace(/[*_`~]/g, "").slice(0, 450);

  for (const token of tokens) {
    try {
      const body   = JSON.stringify({ inputs: clean });
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
          timeout: 45000,
        }, (res) => {
          const chunks = [];
          res.on("data", c => chunks.push(c));
          res.on("end", () => {
            const buf = Buffer.concat(chunks);
            if (res.statusCode === 200 && buf.length > 500) resolve(buf);
            else resolve(null);
          });
        });
        req.on("error", () => resolve(null));
        req.on("timeout", () => { req.destroy(); resolve(null); });
        req.write(body); req.end();
      });

      if (result) {
        console.log(`[Voice] ✅ TTS: ${(result.length / 1024).toFixed(0)}KB`);
        return { success: true, buffer: result, cleanup: () => {} };
      }
    } catch {}
  }

  return { success: false };
}

module.exports = { generateVoice };
