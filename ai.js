/**
 * ai.js — Groq LLM + HuggingFace Image Generation
 * EMEMZYVISUALS DIGITALS | Emmanuel.A
 */
"use strict";

require("dotenv").config();
const https = require("https");
const http  = require("http");

const GROQ_KEY   = process.env.GROQ_API_KEY || "";
const GROQ_MODEL = process.env.GROQ_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct";

// ─── HF Token rotation ───────────────────────────────────────────────────────
let _hfIdx = 0;
function getHFToken() {
  const tokens = [
    process.env.HF_TOKEN, process.env.HF_TOKEN_2, process.env.HF_TOKEN_3,
  ].map(t => (t || "").trim()).filter(Boolean);
  if (!tokens.length) return null;
  return tokens[_hfIdx % tokens.length];
}
function rotateHF() {
  _hfIdx++;
  console.log(`[HF] Rotated to token ${(_hfIdx % 3) + 1}`);
}

// ─── Groq chat completion ─────────────────────────────────────────────────────
async function askGroq(systemPrompt, userMessage, history = [], retries = 3) {
  if (!GROQ_KEY) return null;

  const messages = [
    { role: "system", content: systemPrompt },
    ...history.slice(-20),
    { role: "user", content: userMessage },
  ];

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const body = JSON.stringify({ model: GROQ_MODEL, messages, max_tokens: 1200, temperature: 0.85 });
      const result = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: "api.groq.com",
          path: "/openai/v1/chat/completions",
          method: "POST",
          headers: {
            "Authorization": `Bearer ${GROQ_KEY}`,
            "Content-Type":  "application/json",
            "Content-Length": Buffer.byteLength(body),
          },
          timeout: 30000,
        }, res => {
          let raw = "";
          res.on("data", c => raw += c);
          res.on("end", () => {
            try {
              const d = JSON.parse(raw);
              if (res.statusCode === 429) {
                resolve({ rateLimited: true, retry: parseInt(res.headers["retry-after"] || "3") });
              } else {
                resolve(d);
              }
            } catch { resolve(null); }
          });
        });
        req.on("error", reject);
        req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
        req.write(body); req.end();
      });

      if (result?.rateLimited) {
        const wait = (result.retry + 1) * 1000;
        console.log(`[Groq] Rate limited — waiting ${wait}ms (attempt ${attempt}/${retries})`);
        await new Promise(r => setTimeout(r, wait));
        continue;
      }

      return result?.choices?.[0]?.message?.content || null;
    } catch (e) {
      if (attempt === retries) return null;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  return null;
}

// ─── Transcribe audio ─────────────────────────────────────────────────────────
async function transcribeAudio(audioBuffer, mimeType = "audio/ogg") {
  if (!GROQ_KEY || !audioBuffer) return null;
  try {
    const boundary = "----FormBoundary" + Math.random().toString(36).slice(2);
    const ext      = mimeType.includes("mp4") ? "mp4" : mimeType.includes("webm") ? "webm" : "ogg";
    const part1    = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${ext}"\r\nContent-Type: ${mimeType}\r\n\r\n`);
    const part2    = Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-large-v3-turbo\r\n--${boundary}--\r\n`);
    const body     = Buffer.concat([part1, audioBuffer, part2]);

    const result = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: "api.groq.com",
        path: "/openai/v1/audio/transcriptions",
        method: "POST",
        headers: {
          "Authorization": `Bearer ${GROQ_KEY}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
        },
        timeout: 30000,
      }, res => {
        let raw = "";
        res.on("data", c => raw += c);
        res.on("end", () => { try { resolve(JSON.parse(raw)); } catch { resolve(null); } });
      });
      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
      req.write(body); req.end();
    });
    return result?.text || null;
  } catch { return null; }
}

// ─── HuggingFace image generation ────────────────────────────────────────────
const HF_MODELS = [
  "black-forest-labs/FLUX.1-schnell",
  "stabilityai/stable-diffusion-xl-base-1.0",
  "runwayml/stable-diffusion-v1-5",
];

async function generateImage(prompt) {
  const token = getHFToken();
  if (!token) return null;

  for (const model of HF_MODELS) {
    try {
      const body   = JSON.stringify({ inputs: prompt.slice(0, 500) });
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
          timeout: 60000,
        }, (res) => {
          const chunks = [];
          res.on("data", c => chunks.push(c));
          res.on("end", () => {
            const buf = Buffer.concat(chunks);
            if (res.statusCode === 200 && buf.length > 1000) {
              resolve(buf);
            } else if (res.statusCode === 402) {
              rotateHF();
              resolve(null);
            } else {
              resolve(null);
            }
          });
        });
        req.on("error", () => resolve(null));
        req.on("timeout", () => { req.destroy(); resolve(null); });
        req.write(body); req.end();
      });

      if (result) {
        console.log(`[ImageGen] ✅ ${model} (${(result.length/1024).toFixed(0)}KB)`);
        return result;
      }
    } catch {}
  }
  return null;
}

// ─── Vision analysis ──────────────────────────────────────────────────────────
async function analyzeImage(imageBase64, mimeType = "image/jpeg", question = "Describe this image.") {
  if (!GROQ_KEY) return null;
  try {
    const body = JSON.stringify({
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      messages: [{
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
          { type: "text", text: question },
        ],
      }],
      max_tokens: 1000,
    });

    const result = await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: "api.groq.com",
        path: "/openai/v1/chat/completions",
        method: "POST",
        headers: {
          "Authorization": `Bearer ${GROQ_KEY}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 30000,
      }, res => {
        let raw = "";
        res.on("data", c => raw += c);
        res.on("end", () => { try { resolve(JSON.parse(raw)); } catch { resolve(null); } });
      });
      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
      req.write(body); req.end();
    });

    console.log(`[Vision] ✅ ${result?.model || "unknown"}`);
    return result?.choices?.[0]?.message?.content || null;
  } catch { return null; }
}

module.exports = { askGroq, transcribeAudio, generateImage, analyzeImage };
