/**
 * lumeo_voice.js — Voice Note Generation
 * EMEMZYVISUALS DIGITALS | Emmanuel.A
 *
 * PRIMARY: Groq Orpheus TTS — canopylabs/orpheus-v1-english
 *   Endpoint: POST api.groq.com/openai/v1/audio/speech
 *   Voices: austin, hannah, diana, troy, ethan, marcus (v1-english)
 *   ⚠️  MUST accept terms at console.groq.com first
 *   Input limit: 200 chars per request — we chunk longer text
 *   Returns WAV → FFmpeg converts to OGG Opus for WhatsApp PTT
 *
 * FALLBACK: HuggingFace facebook/mms-tts-eng
 */
"use strict";

const fs    = require("fs");
const path  = require("path");
const https = require("https");
const { exec } = require("child_process");

const TMP = "/tmp";

// ─── Voice selection by mood ───────────────────────────────────────────────
const VOICES = {
  casual:    { voice: "diana",   prefix: "" },
  happy:     { voice: "hannah",  prefix: "[cheerful] " },
  excited:   { voice: "hannah",  prefix: "[excited] " },
  sad:       { voice: "diana",   prefix: "[sad] " },
  serious:   { voice: "diana",   prefix: "[serious] " },
  whisper:   { voice: "diana",   prefix: "[whisper] " },
  default:   { voice: "diana",   prefix: "" },
};

// ─── Chunk text into ≤200 char pieces (Groq Orpheus limit) ───────────────────
function chunkText(text, maxLen = 195) {
  const sentences = text.match(/[^.!?]+[.!?]+[\s]?|[^.!?]+$/g) || [text];
  const chunks    = [];
  let   cur       = "";

  for (const s of sentences) {
    const t = s.trim();
    if ((cur + " " + t).trim().length > maxLen) {
      if (cur) chunks.push(cur.trim());
      // If single sentence > maxLen, split by word
      if (t.length > maxLen) {
        const words = t.split(" ");
        let wChunk  = "";
        for (const w of words) {
          if ((wChunk + " " + w).trim().length > maxLen) {
            if (wChunk) chunks.push(wChunk.trim());
            wChunk = w;
          } else wChunk = wChunk ? wChunk + " " + w : w;
        }
        if (wChunk) chunks.push(wChunk.trim());
        cur = "";
      } else cur = t;
    } else cur = cur ? cur + " " + t : t;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.filter(c => c.length > 0);
}

// ─── Single Groq Orpheus TTS call ─────────────────────────────────────────────
function groqTTSChunk(text, voice, key) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      model:           "canopylabs/orpheus-v1-english",
      input:           text.slice(0, 200),
      voice,
      response_format: "wav",
    });

    const req = https.request({
      hostname: "api.groq.com",
      path:     "/openai/v1/audio/speech",
      method:   "POST",
      headers:  {
        "Authorization":  `Bearer ${key}`,
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: 30000,
    }, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode === 200 && buf.length > 500) {
          resolve(buf);
        } else {
          const err = buf.toString().slice(0, 200);
          console.log(`[Voice] Groq chunk HTTP ${res.statusCode}:`, err);
          resolve(null);
        }
      });
    });
    req.on("error",   () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

// ─── Groq Orpheus TTS (primary) ───────────────────────────────────────────────
async function tryGroqTTS(text, mood = "casual") {
  const KEY = (process.env.GROQ_API_KEY || "").trim();
  if (!KEY) return null;

  const { voice, prefix } = VOICES[mood] || VOICES.default;
  const cleanText = text.replace(/[*_~`#]/g, "").replace(/\n+/g, " ").trim();
  const chunks    = chunkText(cleanText);

  console.log(`[Voice] Groq Orpheus: voice=${voice} chunks=${chunks.length}`);

  const wavBuffers = [];
  for (const chunk of chunks) {
    const input  = prefix + chunk;
    const buf    = await groqTTSChunk(input, voice, KEY);
    if (!buf) { console.log("[Voice] Chunk failed — aborting"); return null; }
    wavBuffers.push(buf);
    if (chunks.length > 1) await new Promise(r => setTimeout(r, 300));
  }

  if (wavBuffers.length === 0) return null;

  const ts      = Date.now();
  const oggPath = path.join(TMP, `lumeo_tts_${ts}.ogg`);

  // Concatenate WAV buffers and convert to OGG Opus
  return new Promise((resolve) => {
    if (wavBuffers.length === 1) {
      const wavPath = path.join(TMP, `lumeo_tts_${ts}.wav`);
      fs.writeFileSync(wavPath, wavBuffers[0]);
      exec(
        `ffmpeg -i "${wavPath}" -c:a libopus -b:a 24k -ar 24000 -ac 1 -y "${oggPath}" 2>&1`,
        { timeout: 20000 },
        (err) => {
          try { fs.unlinkSync(wavPath); } catch {}
          if (err || !fs.existsSync(oggPath)) { resolve(null); return; }
          try {
            const buf = fs.readFileSync(oggPath);
            console.log(`[Voice] ✅ Groq Orpheus: ${(buf.length/1024).toFixed(0)}KB`);
            resolve({ success: true, buffer: buf, cleanup: () => { try { fs.unlinkSync(oggPath); } catch {} } });
          } catch { resolve(null); }
        }
      );
    } else {
      // Multiple chunks: write each, concat with ffmpeg
      const wavPaths = wavBuffers.map((b, i) => {
        const p = path.join(TMP, `lumeo_chunk_${ts}_${i}.wav`);
        fs.writeFileSync(p, b);
        return p;
      });
      const listPath = path.join(TMP, `lumeo_list_${ts}.txt`);
      fs.writeFileSync(listPath, wavPaths.map(p => `file '${p}'`).join("\n"));

      const concatPath = path.join(TMP, `lumeo_concat_${ts}.wav`);
      exec(
        `ffmpeg -f concat -safe 0 -i "${listPath}" -c copy "${concatPath}" 2>&1`,
        { timeout: 30000 },
        (err1) => {
          wavPaths.forEach(p => { try { fs.unlinkSync(p); } catch {} });
          try { fs.unlinkSync(listPath); } catch {}
          if (err1 || !fs.existsSync(concatPath)) { resolve(null); return; }

          exec(
            `ffmpeg -i "${concatPath}" -c:a libopus -b:a 24k -ar 24000 -ac 1 -y "${oggPath}" 2>&1`,
            { timeout: 20000 },
            (err2) => {
              try { fs.unlinkSync(concatPath); } catch {}
              if (err2 || !fs.existsSync(oggPath)) { resolve(null); return; }
              try {
                const buf = fs.readFileSync(oggPath);
                console.log(`[Voice] ✅ Groq Orpheus (concat): ${(buf.length/1024).toFixed(0)}KB`);
                resolve({ success: true, buffer: buf, cleanup: () => { try { fs.unlinkSync(oggPath); } catch {} } });
              } catch { resolve(null); }
            }
          );
        }
      );
    }
  });
}

// ─── HuggingFace MMS-TTS fallback ────────────────────────────────────────────
async function tryHFTTS(text) {
  const TOKEN = (process.env.HF_TOKEN || "").trim();
  if (!TOKEN) return null;

  const cleanText = text.replace(/[*_~`#]/g, "").slice(0, 400);
  const body      = JSON.stringify({ inputs: cleanText });
  const ts        = Date.now();
  const rawPath   = path.join(TMP, `lumeo_hf_${ts}.wav`);
  const oggPath   = path.join(TMP, `lumeo_hf_${ts}.ogg`);

  return new Promise((resolve) => {
    const req = https.request({
      hostname: "router.huggingface.co",
      path:     "/hf-inference/models/facebook/mms-tts-eng",
      method:   "POST",
      headers:  {
        "Authorization":    `Bearer ${TOKEN}`,
        "Content-Type":     "application/json",
        "Content-Length":   Buffer.byteLength(body),
        "x-wait-for-model": "true",
      },
      timeout: 60000,
    }, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode !== 200 || buf.length < 500) { resolve(null); return; }
        fs.writeFileSync(rawPath, buf);
        exec(
          `ffmpeg -i "${rawPath}" -c:a libopus -b:a 24k -ar 24000 -ac 1 -y "${oggPath}" 2>&1`,
          { timeout: 20000 },
          (err) => {
            try { fs.unlinkSync(rawPath); } catch {}
            if (err) { resolve(null); return; }
            try {
              const vbuf = fs.readFileSync(oggPath);
              console.log(`[Voice] ✅ HF TTS: ${(vbuf.length/1024).toFixed(0)}KB`);
              resolve({ success: true, buffer: vbuf, cleanup: () => { try { fs.unlinkSync(oggPath); } catch {} } });
            } catch { resolve(null); }
          }
        );
      });
    });
    req.on("error",   () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function generateVoice(text, mood = "casual") {
  if (!text?.trim()) return { success: false };
  console.log(`[Voice] Generating: "${text.slice(0, 60)}" mood=${mood}`);

  // 1. Groq Orpheus (primary — must accept terms at console.groq.com first)
  const groq = await tryGroqTTS(text, mood);
  if (groq?.success) return groq;

  // 2. HuggingFace MMS-TTS fallback
  const hf = await tryHFTTS(text);
  if (hf?.success) return hf;

  console.error("[Voice] All TTS methods failed");
  return { success: false };
}

module.exports = { generateVoice };
