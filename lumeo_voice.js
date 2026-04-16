/**
 * lumeo_voice.js — Voice Note Generation
 * EMEMZYVISUALS DIGITALS | Emmanuel.A
 *
 * PRIMARY: Groq Orpheus TTS (canopylabs/orpheus-v1-english)
 *   API: POST https://api.groq.com/openai/v1/audio/speech
 *   Input limit: 200 chars per call — chunked automatically
 *   MUST accept terms at console.groq.com first
 *   Male voices: leo, dan, austin, marcus, ethan, thomas
 *
 * FALLBACK: HuggingFace facebook/mms-tts-eng
 */
"use strict";

const fs             = require("fs");
const path           = require("path");
const https          = require("https");
const { exec }       = require("child_process");
const { execSync }   = require("child_process");

const TMP = "/tmp";

// Male voices ONLY — picked for best clarity
const VOICE = "austin";  // Male voice (valid Groq Orpheus voices: autumn diana hannah austin daniel troy)
const VOICE_ALT = "troy";  // Alt male voice

// ─── Chunk text at sentence boundaries, max 190 chars ─────────────────────
function chunkText(text) {
  const LIMIT = 190;
  const clean = text.replace(/[*_~`#>]/g, "").replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
  if (clean.length <= LIMIT) return [clean];

  const chunks = [];
  const sentences = clean.split(/(?<=[.!?])\s+/);
  let cur = "";

  for (const s of sentences) {
    const test = cur ? cur + " " + s : s;
    if (test.length > LIMIT) {
      if (cur) chunks.push(cur.trim());
      // If single sentence > limit, split at word boundary
      if (s.length > LIMIT) {
        const words = s.split(" ");
        cur = "";
        for (const w of words) {
          const wtest = cur ? cur + " " + w : w;
          if (wtest.length > LIMIT) { if (cur) chunks.push(cur.trim()); cur = w; }
          else cur = wtest;
        }
      } else cur = s;
    } else cur = test;
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.filter(c => c.length > 0);
}

// ─── Single Groq TTS request ─────────────────────────────────────────────────
async function groqTTSChunk(text, voice, key) {
  return new Promise((resolve) => {
    const inputText = text.slice(0, 200);
    const body = JSON.stringify({
      model:           "canopylabs/orpheus-v1-english",
      input:           inputText,
      voice:           voice,
      response_format: "wav",
    });

    console.log("[Voice] Groq request: voice=" + voice + " len=" + inputText.length + " chars");

    const req = https.request({
      hostname: "api.groq.com",
      path:     "/openai/v1/audio/speech",
      method:   "POST",
      headers: {
        "Authorization":  "Bearer " + key,
        "Content-Type":   "application/json",
        "Content-Length": Buffer.byteLength(body),
      },
      timeout: 40000,
    }, (res) => {
      const chunks = [];
      res.on("data", c => chunks.push(c));
      res.on("end", () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode === 200 && buf.length > 300) {
          console.log("[Voice] Groq chunk OK: " + buf.length + " bytes");
          resolve(buf);
        } else {
          const errStr = buf.toString().slice(0, 300);
          console.log("[Voice] Groq HTTP " + res.statusCode + ": " + errStr);
          // 400 usually = terms not accepted yet at console.groq.com
          // 401 = wrong API key
          // 429 = rate limit
          resolve(null);
        }
      });
    });
    req.on("error",   (e) => { console.log("[Voice] Groq connection error:", e.message); resolve(null); });
    req.on("timeout", () => { console.log("[Voice] Groq timeout"); req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

// ─── Convert WAV file to OGG Opus (WhatsApp PTT format) ───────────────────
async function wavToOgg(wavPath, oggPath) {
  return new Promise((resolve) => {
    exec(
      'ffmpeg -i "' + wavPath + '" -c:a libopus -b:a 24k -ar 24000 -ac 1 -y "' + oggPath + '" 2>&1',
      { timeout: 20000 },
      (err, stdout, stderr) => {
        if (err) { console.log("[Voice] FFmpeg:", stderr?.slice(0, 100)); resolve(false); }
        else resolve(true);
      }
    );
  });
}

// ─── Concatenate multiple WAV files ──────────────────────────────────────────
async function concatWavs(wavPaths, outPath) {
  if (wavPaths.length === 1) {
    fs.copyFileSync(wavPaths[0], outPath);
    return true;
  }
  const listPath = path.join(TMP, "lumeo_concat_" + Date.now() + ".txt");
  fs.writeFileSync(listPath, wavPaths.map(p => "file '" + p + "'").join("\n"));
  return new Promise((resolve) => {
    exec(
      'ffmpeg -f concat -safe 0 -i "' + listPath + '" -c copy "' + outPath + '" 2>&1',
      { timeout: 30000 },
      (err) => {
        try { fs.unlinkSync(listPath); } catch {}
        resolve(!err);
      }
    );
  });
}

// ─── Groq Orpheus TTS (primary) ──────────────────────────────────────────────
async function tryGroqTTS(text) {
  const KEY = (process.env.GROQ_API_KEY || "").trim();
  if (!KEY) return null;

  const chunks = chunkText(text);
  console.log("[Voice] Groq Orpheus: voice=" + VOICE + " chunks=" + chunks.length);

  const ts       = Date.now();
  const wavPaths = [];

  // Generate each chunk
  for (let i = 0; i < chunks.length; i++) {
    const buf = await groqTTSChunk(chunks[i], VOICE, KEY);
    if (!buf) {
      // Try alt voice
      const buf2 = await groqTTSChunk(chunks[i], VOICE_ALT, KEY);
      if (!buf2) {
        // Cleanup and fail
        wavPaths.forEach(p => { try { fs.unlinkSync(p); } catch {} });
        return null;
      }
      const p = path.join(TMP, "lumeo_wav_" + ts + "_" + i + ".wav");
      fs.writeFileSync(p, buf2);
      wavPaths.push(p);
    } else {
      const p = path.join(TMP, "lumeo_wav_" + ts + "_" + i + ".wav");
      fs.writeFileSync(p, buf);
      wavPaths.push(p);
    }
    if (chunks.length > 1) await new Promise(r => setTimeout(r, 200));
  }

  const concatWav = path.join(TMP, "lumeo_concat_" + ts + ".wav");
  const oggPath   = path.join(TMP, "lumeo_tts_" + ts + ".ogg");

  const concatOk = await concatWavs(wavPaths, concatWav);
  wavPaths.forEach(p => { try { fs.unlinkSync(p); } catch {} });
  if (!concatOk) return null;

  const convOk = await wavToOgg(concatWav, oggPath);
  try { fs.unlinkSync(concatWav); } catch {}
  if (!convOk || !fs.existsSync(oggPath) || fs.statSync(oggPath).size < 200) return null;

  const buf = fs.readFileSync(oggPath);
  console.log("[Voice] Groq Orpheus done: " + (buf.length / 1024).toFixed(0) + "KB");
  return {
    success: true, buffer: buf,
    cleanup: () => { try { fs.unlinkSync(oggPath); } catch {} },
  };
}

// ─── HuggingFace MMS-TTS (fallback) ──────────────────────────────────────────
async function tryHFTTS(text) {
  const TOKEN = (process.env.HF_TOKEN || "").trim();
  if (!TOKEN) return null;

  const cleanText = text.replace(/[*_~`#]/g, "").slice(0, 400);
  const body      = JSON.stringify({ inputs: cleanText });
  const ts        = Date.now();
  const rawPath   = path.join(TMP, "lumeo_hf_" + ts + ".flac");
  const oggPath   = path.join(TMP, "lumeo_hf_" + ts + ".ogg");

  return new Promise((resolve) => {
    const req = https.request({
      hostname: "router.huggingface.co",
      path:     "/hf-inference/models/facebook/mms-tts-eng",
      method:   "POST",
      headers: {
        "Authorization":    "Bearer " + TOKEN,
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
        if (res.statusCode !== 200 || buf.length < 300) { resolve(null); return; }
        fs.writeFileSync(rawPath, buf);
        exec(
          'ffmpeg -i "' + rawPath + '" -c:a libopus -b:a 24k -ar 24000 -ac 1 -y "' + oggPath + '" 2>&1',
          { timeout: 20000 },
          (err) => {
            try { fs.unlinkSync(rawPath); } catch {}
            if (err || !fs.existsSync(oggPath)) { resolve(null); return; }
            const vbuf = fs.readFileSync(oggPath);
            console.log("[Voice] HF TTS: " + (vbuf.length / 1024).toFixed(0) + "KB");
            resolve({ success: true, buffer: vbuf, cleanup: () => { try { fs.unlinkSync(oggPath); } catch {} } });
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
async function generateVoice(text) {
  if (!text || !text.trim()) return { success: false };
  console.log("[Voice] Generating: \"" + text.slice(0, 60) + "\"");

  // 1. Groq Orpheus (MUST accept terms at console.groq.com first)
  const groq = await tryGroqTTS(text);
  if (groq?.success) { console.log("[Voice] Groq Orpheus success"); return groq; }

  // 2. HuggingFace fallback
  const hf = await tryHFTTS(text);
  if (hf?.success) { console.log("[Voice] HF TTS success"); return hf; }

  console.error("[Voice] All TTS failed — returning text fallback");
  return { success: false };
}

module.exports = { generateVoice };
