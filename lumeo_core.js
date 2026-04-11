/**
 * lumeo_core.js — Lumeo AI: Brain
 * EMEMZYVISUALS DIGITALS | Emmanuel.A
 *
 * Handles all message types, classifies intent, routes to correct handler
 */
"use strict";

const { askGroq, generateImage, analyzeImage, transcribeAudio } = require("./ai");
const { getLumeoPrompt, shouldGreetDev, getDevGreeting } = require("./personality");
const { getUser, updateUserName, addMemory, getHistory, clearMemory, cacheUser, getAllCachedPhones, checkRateLimit } = require("./lumeo_users");
const { downloadMedia }            = require("./lumeo_downloader");
const { createSticker }            = require("./lumeo_sticker");
const { createPDF }                = require("./lumeo_pdf");
const { generateWhatsAppScreenshot, parseScreenshotRequest } = require("./lumeo_screenshot");
const { runPromotion, sendEmailOutreach } = require("./lumeo_marketing");
const { postStatus, generateStatusContent } = require("./lumeo_status");

// ─── In-memory dedup + voice mode ────────────────────────────────────────────
const _seen          = new Map();
const _voicePhones   = new Set();
const _lastMsg       = new Map();

function isVoice(phone) { return _voicePhones.has(phone); }

// ─── Strip hollow Groq openers ────────────────────────────────────────────────
function clean(text) {
  if (!text) return "";
  return text
    .replace(/^(?:Hey!?\s+)?(?:I['`]?m (?:doing )?(?:great|good|well|amazing|fine)[^.!?]*[.!?]\s*)/i, "")
    .replace(/^(?:Thanks? for (?:checking in|asking)[^.!?]*[.!?]\s*)/i, "")
    .replace(/^(?:Certainly!?\s*|Of course!?\s*|Sure thing!?\s*|Absolutely!?\s*)/i, "")
    .replace(/https?:\/\/example\.com\S*/gi, "")
    .trim();
}

// ─── Intent classification ────────────────────────────────────────────────────
async function classifyIntent(text, history = []) {
  if (!text?.trim()) return { type: "chat", prompt: text };

  const ctx = history.slice(-6).map(m => `${m.role === "user" ? "User" : "Lumeo"}: ${(m.content || "").slice(0, 120)}`).join("\n");

  const prompt =
    `Classify this WhatsApp message and return ONLY valid JSON.\n\nContext:\n${ctx || "none"}\n\nMessage: "${text}"\n\n` +
    `{"type":"...", "prompt":"..."}\n\n` +
    `INTENT TYPES:\n` +
    `- screenshot: ALWAYS when message contains "whatsapp screenshot", "fake whatsapp", "whatsapp chat screenshot", "generate iphone/android whatsapp"\n` +
    `- image_gen: CREATE/DRAW/GENERATE an image/logo/art (NOT whatsapp screenshots)\n` +
    `- video_gen: CREATE a video clip\n` +
    `- music_gen: CREATE/COMPOSE a song or beat\n` +
    `- voice_send: SPEAK something as voice note\n` +
    `- voice_mode_on: reply ONLY in voice notes from now on\n` +
    `- voice_mode_off: go back to text replies\n` +
    `- code: WRITE/FIX/EXPLAIN code\n` +
    `- web_search: current news/prices/scores/weather\n` +
    `- download: DOWNLOAD music/video/movie by NAME or URL — "play Fun by Rema", "download this https://...", any TikTok/Instagram/YouTube link\n` +
    `- sticker: convert image/video TO WhatsApp sticker\n` +
    `- pdf: CREATE a PDF document — receipt, letter, certificate, exam, CV\n` +
    `- promote: PROMOTE/ADVERTISE/MARKET a project/service to someone — "promote X to all users", "send promo to +234..."\n` +
    `- email: SEND EMAIL outreach — "send email to ...", "email this company"\n` +
    `- status_post: POST a WhatsApp status update\n` +
    `- chat: EVERYTHING ELSE — greetings, questions, Pidgin, casual talk\n` +
    `- NEVER image_gen for "send me your pic", "send your photo", "show yourself" — these are chat\n` +
    `- NEVER image_gen for anything with "whatsapp screenshot" — use screenshot\n` +
    `- prompt: clean extracted request, remove filler\n\nReturn ONLY the JSON.`;

  try {
    const raw    = await askGroq("Classify messages. Return ONLY valid JSON.", prompt, []);
    const parsed = JSON.parse((raw || "{}").replace(/```json|```/g, "").trim());
    return { type: parsed.type || "chat", prompt: parsed.prompt || text };
  } catch {
    return { type: "chat", prompt: text };
  }
}

// ─── Human typing simulation ──────────────────────────────────────────────────
async function humanTyping(sock, jid, len = 100) {
  try {
    await sock.sendPresenceUpdate("composing", jid);
    // Realistic typing speed: ~40-60 WPM, with natural variance
    const words   = Math.ceil(len / 5);
    const baseMs  = words * 180;  // ~333 WPM base
    const variance = (Math.random() - 0.5) * baseMs * 0.4;
    const delay   = Math.min(Math.max(baseMs + variance, 600), 5000);
    await new Promise(r => setTimeout(r, delay));
    await sock.sendPresenceUpdate("paused", jid);
  } catch {}
}

// ─── Smart send (text or voice) ───────────────────────────────────────────────
async function sendSmart(sock, jid, text, phone, mentions = []) {
  if (!text || !jid) return;
  try { await sock.sendMessage(jid, { text, mentions }); } catch {}
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN MESSAGE HANDLER
// ═════════════════════════════════════════════════════════════════════════════
async function handleMessage(params) {
  const {
    text, phone, pushName, sock, jid, senderJid,
    isGroup, isDev,
    hasImage, imageBase64, imageMimeType,
    hasAudio, audioBuffer, audioMime,
    hasVideo, videoMessage,
    hasSticker,
    hasDocument, documentBuffer, documentName, documentMime,
    groupJids = [],
  } = params;

  const replyJid  = isGroup ? jid : senderJid;
  const mentions  = isGroup ? [senderJid] : [];
  const send      = async (msg) => { if (msg) await sendSmart(sock, replyJid, msg, phone, mentions); };

  // ── Cache user ─────────────────────────────────────────────────────────────
  cacheUser(phone, pushName);
  updateUserName(phone, pushName).catch(() => {});

  // ── Greet developer on first message of the day ───────────────────────────
  if (isDev && text && shouldGreetDev(phone)) {
    try { await sock.sendMessage(replyJid, { text: getDevGreeting(), mentions }); } catch {}
    // Small delay so greeting arrives before reply
    await new Promise(r => setTimeout(r, 1200));
  }

  // ── Dedup ──────────────────────────────────────────────────────────────────
  if (text) {
    const key  = `${phone}_${text.slice(0, 50)}`;
    const last = _seen.get(key);
    if (last && Date.now() - last < 3000) return;
    _seen.set(key, Date.now());
    if (_seen.size > 500) { const cut = Date.now() - 60000; for (const [k, t] of _seen) if (t < cut) _seen.delete(k); }
    const lp = _lastMsg.get(phone);
    if (lp && Date.now() - lp < 1000) return;
    _lastMsg.set(phone, Date.now());
  }

  // ── Save incoming ──────────────────────────────────────────────────────────
  const memEntry = text || (hasAudio ? "[Voice note]" : hasDocument ? `[File: ${documentName || "doc"}]` : hasSticker ? "[Sticker]" : null);
  if (memEntry && !hasImage) await addMemory(phone, "user", memEntry);

  // ── Load history ───────────────────────────────────────────────────────────
  const history = await getHistory(phone, 40);

  // ── Build system prompt ────────────────────────────────────────────────────
  const userRec = await getUser(phone);
  const nowWAT  = new Date().toLocaleString("en-NG", { timeZone: "Africa/Lagos", weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const recentCtx = history.slice(-12).map(m => `${m.role === "user" ? (pushName || "User") : "Lumeo"}: ${(m.content || "").slice(0, 200)}`).join("\n");

  const sysPrompt = getLumeoPrompt({
    isDev, isGroup, userName: pushName,
    language: userRec?.language || "english",
    currentTime: nowWAT,
    recentHistory: recentCtx,
  });

  const saveReply = async (r) => { if (r) await addMemory(phone, "assistant", String(r).slice(0, 600)); };

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 1: AUDIO — transcribe → reprocess
  // ══════════════════════════════════════════════════════════════════════════
  if (hasAudio && audioBuffer) {
    console.log("[Lumeo] 🎧 Transcribing audio...");
    const transcribed = await transcribeAudio(audioBuffer, audioMime || "audio/ogg");
    if (transcribed?.length > 2) {
      console.log(`[STT] ✅ "${transcribed.slice(0, 80)}"`);
      await addMemory(phone, "user", `[Voice]: ${transcribed}`);
      return handleMessage({ ...params, text: transcribed, hasAudio: false, audioBuffer: null });
    }
    return send("Didn't catch that — try typing it out?");
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 2: IMAGE
  // ══════════════════════════════════════════════════════════════════════════
  if (hasImage && imageBase64) {
    const q = text || "";
    console.log(`[Lumeo] 👁️ Image${q ? ` — "${q.slice(0, 50)}"` : ""}`);

    // Sticker from image — check FIRST
    if (/sticker|convert.*sticker|make.*sticker|turn.*sticker/i.test(q)) {
      await sock.sendMessage(replyJid, { text: "Converting to sticker 🎨...", mentions });
      const webp = await createSticker(Buffer.from(imageBase64, "base64"), imageMimeType || "image/jpeg");
      if (webp) { await sock.sendMessage(replyJid, { sticker: webp }); await saveReply("[Sticker created]"); }
      else await send("Couldn't convert that — try a clearer image!");
      return;
    }

    // Analyze image
    const vision = await analyzeImage(imageBase64, imageMimeType || "image/jpeg", q || "Describe this image.");
    const imgMem = `[Image: ${vision?.slice(0, 200) || "received"}${q ? ` | User said: "${q}"` : ""}]`;
    await addMemory(phone, "user", imgMem);

    const imgSys = sysPrompt +
      "\n\nYou're looking at an image the user sent. React naturally. Don't say 'Image Analysis:'." +
      "\nIf they want to EDIT/DESIGN their image: explain you can't edit it directly but can create a new design inspired by it." +
      "\nIf they want STICKER: tell them to send it with caption 'make sticker'.";

    const freshHistory = await getHistory(phone, 40);
    const reply = clean(await askGroq(imgSys, q || `Describe and react to this image. Vision: ${vision || "unclear"}`, freshHistory));
    await humanTyping(sock, replyJid, reply?.length || 50);
    await sendSmart(sock, replyJid, reply || "Nice one!", phone, mentions);
    await saveReply(reply);
    return;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 3: STICKER REACT
  // ══════════════════════════════════════════════════════════════════════════
  if (hasSticker) {
    const r = clean(await askGroq(sysPrompt + "\n\nSomeone sent a sticker. React naturally in 1-2 lines.", "React to this sticker", history));
    await send(r || "😂"); await saveReply(r);
    return;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 4: VIDEO
  // ══════════════════════════════════════════════════════════════════════════
  if (hasVideo) {
    if (/sticker|convert.*sticker|make.*sticker|turn.*sticker/i.test(text || "")) {
      await sock.sendMessage(replyJid, { text: "Converting video to sticker 🎨...", mentions });
      try {
        const { downloadContentFromMessage } = require("@whiskeysockets/baileys");
        if (videoMessage) {
          const stream = await downloadContentFromMessage(videoMessage, "video");
          const chunks = []; for await (const chunk of stream) chunks.push(chunk);
          const vidBuf = Buffer.concat(chunks);
          const webp   = await createSticker(vidBuf, "video/mp4");
          if (webp) { await sock.sendMessage(replyJid, { sticker: webp }); await saveReply("[Video sticker]"); return; }
        }
      } catch (e) { console.error("[VideoSticker]", e.message); }
      await send("Couldn't convert that video — try a clip under 5 seconds!");
      return;
    }
    if (text) {
      const r = clean(await askGroq(sysPrompt + "\n\nUser sent a video with caption. Respond to the caption.", text, history));
      await humanTyping(sock, replyJid, r?.length || 50);
      await sendSmart(sock, replyJid, r || "Got it!", phone, mentions);
      await saveReply(r);
    }
    return;
  }

  if (!text) return;

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 5: TEXT — classify → route
  // ══════════════════════════════════════════════════════════════════════════
  const intent = await classifyIntent(text, history);
  console.log(`[Lumeo] 🧠 Intent: ${intent.type} | "${text.slice(0, 60)}" | Phone: ${phone}`);

  // ── Voice mode ──────────────────────────────────────────────────────────
  if (intent.type === "voice_mode_on") {
    _voicePhones.add(phone);
    await send("✅ Voice note mode on! I'll reply in voice notes now."); await saveReply("[Voice mode ON]"); return;
  }
  if (intent.type === "voice_mode_off") {
    _voicePhones.delete(phone);
    await send("✅ Back to text replies!"); await saveReply("[Voice mode OFF]"); return;
  }

  // ── Screenshot ─────────────────────────────────────────────────────────
  if (intent.type === "screenshot") {
    await sock.sendMessage(replyJid, { text: "Creating WhatsApp screenshot 📸...", mentions });
    try {
      const ssText = intent.prompt || text;
      const convFormatted = await askGroq(
        "Format this as a WhatsApp conversation. Return ONLY lines like:\nName: message\nMe: message\nUse the names given or 'Me' and 'Friend'.",
        ssText, []
      );
      const { messages, contact } = parseScreenshotRequest(convFormatted || ssText);
      if (!messages.length) { await send("Tell me the conversation — e.g:\nJohn: Hey!\nMe: What's up?"); return; }

      const styleM = /android/i.test(ssText) ? "android" : "iphone";
      const themeM = /dark/i.test(ssText) ? "dark" : /light/i.test(ssText) ? "light" : "dark";
      const result = await generateWhatsAppScreenshot(messages, { style: styleM, theme: themeM, contact });

      if (result?.success) {
        await sock.sendMessage(replyJid, { image: result.buffer, caption: `📱 WhatsApp screenshot (${styleM} · ${themeM})`, mimetype: "image/png" });
        await saveReply("[Screenshot generated]");
      } else { await send("Screenshot failed. Try again with clearer conversation format!"); }
    } catch (e) { console.error("[Screenshot]", e.message); await send("Screenshot error. Try again!"); }
    return;
  }

  // ── Image generation ────────────────────────────────────────────────────
  if (intent.type === "image_gen") {
    const waits = ["On it 🎨", "Working on that...", "Give me a sec 🖌️"];
    await sock.sendMessage(replyJid, { text: waits[Math.floor(Math.random() * waits.length)], mentions });
    const buf = await generateImage(intent.prompt || text);
    if (buf) {
      await sock.sendMessage(replyJid, { image: buf, caption: "✨ Here you go!", mimetype: "image/jpeg" });
      await saveReply(`[Image: ${(intent.prompt || text).slice(0, 80)}]`);
    } else {
      await send("Image generation failed. Try again in a minute!");
    }
    return;
  }

  // ── Video generation ────────────────────────────────────────────────────
  if (intent.type === "video_gen") {
    await sock.sendMessage(replyJid, { text: "Creating that video 🎬...", mentions });
    setImmediate(async () => {
      try {
        const { generateVideo } = require("./lumeo_video");
        const r = await generateVideo(intent.prompt || text);
        if (r?.success && r.buffer) {
          await sock.sendMessage(replyJid, { video: r.buffer, mimetype: "video/mp4", fileName: "lumeo_video.mp4", caption: "🎬 Here's your video!" });
          await saveReply("[Video generated]");
          if (r.cleanup) r.cleanup();
        } else { await send("Video generation failed. Try again!"); }
      } catch (e) { console.error("[VideoGen]", e.message); await send("Video error. Try again!"); }
    });
    return;
  }

  // ── Music generation ────────────────────────────────────────────────────
  if (intent.type === "music_gen") {
    await sock.sendMessage(replyJid, { text: "Composing that 🎵...", mentions });
    setImmediate(async () => {
      try {
        const { generateMusic } = require("./lumeo_music");
        const r = await generateMusic(intent.prompt || text);
        if (r?.hasAudio && r.buffer) {
          await sock.sendMessage(replyJid, { audio: r.buffer, mimetype: "audio/mpeg", fileName: `${r.title || "Lumeo"}.mp3`, caption: `🎵 ${r.title || "Your track!"}` });
          await saveReply(`[Music: ${(intent.prompt || text).slice(0, 60)}]`);
          if (r.cleanup) r.cleanup();
        } else { await send("Music generation failed. Try again!"); }
      } catch (e) { console.error("[MusicGen]", e.message); await send("Music error. Try again!"); }
    });
    return;
  }

  // ── Download ────────────────────────────────────────────────────────────
  if (intent.type === "download") {
    const isVid     = /video|movie|film|series|episode|show|clip|reel/i.test(text);
    const { detectPlatform, cleanQuery } = require("./lumeo_downloader");
    const { isUrl, platform } = detectPlatform(text);
    const searchQ   = cleanQuery(text);

    let ackMsg;
    if (isUrl) {
      const names = { youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram", twitter: "Twitter", facebook: "Facebook", soundcloud: "SoundCloud" };
      ackMsg = `🔗 Downloading from ${names[platform] || "link"}...`;
    } else if (isVid) {
      ackMsg = `🎬 Searching for "${searchQ}"...`;
    } else {
      ackMsg = `🎵 Searching SoundCloud for "${searchQ}"...`;
    }
    await sock.sendMessage(replyJid, { text: ackMsg, mentions });

    setImmediate(async () => {
      try {
        const result = await downloadMedia(text, isVid ? "video" : "music");
        if (!result?.success) {
          await send(result?.error || "Couldn't download that. Check the name or paste the direct link!"); return;
        }

        if (result.thumbBuf) {
          await sock.sendMessage(replyJid, { image: result.thumbBuf, caption: "✅ Downloaded! Sending now...", mimetype: "image/jpeg" });
        }

        if (result.videoBuf) {
          await sock.sendMessage(replyJid, { video: result.videoBuf, mimetype: "video/mp4", fileName: `${searchQ.slice(0, 40)}.mp4`, caption: "🎬 Here's your video!" });
        } else if (result.audioBuf) {
          // 1. Send cover art first (if available)
          if (result.thumbBuf && result.thumbBuf.length > 1000) {
            try {
              await sock.sendMessage(replyJid, {
                image: result.thumbBuf,
                caption: `🎵 *${result.title || searchQ}*`,
                mimetype: "image/jpeg",
              });
              await new Promise(r => setTimeout(r, 800));
            } catch {}
          }

          // 2. Send audio file
          const trackName = (result.title || searchQ).slice(0, 60);
          await sock.sendMessage(replyJid, {
            audio: result.audioBuf, mimetype: "audio/mpeg",
            fileName: `${trackName.replace(/[^a-z0-9 ]/gi,"_")}.mp3`,
            caption: `🎧 ${trackName}`,
          });

          // 3. Send lyrics link
          const GENIUS = (process.env.GENIUS_KEY || "").trim();
          if (GENIUS) {
            try {
              const https = require("https");
              const gData = await new Promise(res => {
                const req = https.get({
                  hostname: "api.genius.com",
                  path: `/search?q=${encodeURIComponent(trackName)}`,
                  headers: { "Authorization": `Bearer ${GENIUS}` },
                  timeout: 8000,
                }, r => {
                  let d = ""; r.on("data", c => d += c);
                  r.on("end", () => { try { res(JSON.parse(d)); } catch { res(null); } });
                });
                req.on("error", () => res(null));
                req.on("timeout", () => { req.destroy(); res(null); });
              });
              const hit = gData?.response?.hits?.[0]?.result;
              if (hit?.url) {
                await sock.sendMessage(replyJid, {
                  text: `📝 *${hit.title}* — ${hit.primary_artist?.name || ""}
${hit.url}`,
                  mentions: [],
                });
              } else {
                await sock.sendMessage(replyJid, {
                  text: `📝 Lyrics: https://www.google.com/search?q=${encodeURIComponent(trackName + " lyrics")}`,
                  mentions: [],
                });
              }
            } catch {
              await sock.sendMessage(replyJid, {
                text: `📝 Lyrics: https://www.google.com/search?q=${encodeURIComponent(trackName + " lyrics")}`,
                mentions: [],
              });
            }
          } else {
            await sock.sendMessage(replyJid, {
              text: `📝 Lyrics: https://www.google.com/search?q=${encodeURIComponent(trackName + " lyrics")}`,
              mentions: [],
            });
          }
        }

        await saveReply(`[Downloaded: ${searchQ}]`);
        if (result.cleanup) result.cleanup();
      } catch (e) { console.error("[Download]", e.message); await send("Download error. Try again!"); }
    });
    return;
  }

  // ── Sticker (from text, user hasn't sent media yet) ────────────────────
  if (intent.type === "sticker") {
    if (!hasImage && !hasVideo) { await send("Send me the image or video you want to convert — add 'make sticker' as caption 😊"); return; }
    return;
  }

  // ── PDF creation ────────────────────────────────────────────────────────
  if (intent.type === "pdf") {
    await sock.sendMessage(replyJid, { text: "Creating that PDF 📄...", mentions });
    try {
      const isLong   = text.length > 150;
      let docContent, docTitle;
      if (isLong) {
        docContent = await askGroq(
          "You are a professional document formatter. Format the provided content clearly. Keep ALL information. Use clear section headings. Plain text only — no markdown symbols, no asterisks, no file paths.",
          text, []
        ) || text;
        docTitle = text.split("\n").find(l => l.trim().length > 3 && l.trim().length < 80)?.trim() || "Document";
      } else {
        docContent = await askGroq(
          sysPrompt + "\n\nGenerate complete professional document content. Clear headings. Plain text. Be thorough.",
          text, history
        ) || text;
        docTitle = clean(await askGroq("Return ONLY a document title, max 6 words, nothing else.", `Title for: "${text.slice(0, 100)}"`, [])) || "Lumeo Document";
      }

      const result = await createPDF(docContent, docTitle);
      if (result?.success && result.buffer?.length > 500) {
        await sock.sendMessage(replyJid, { document: result.buffer, mimetype: "application/pdf", fileName: result.filename, caption: `📄 *${docTitle}*\n_Generated by Lumeo AI — EMEMZYVISUALS DIGITALS_` });
        await saveReply(`[PDF: ${docTitle}]`);
      } else { await send("PDF creation failed. Try again!"); }
    } catch (e) { console.error("[PDF]", e.message); await send("PDF error. Try again!"); }
    return;
  }

  // ── Marketing / Promotion ────────────────────────────────────────────────
  if (intent.type === "promote") {
    if (!isDev) { await send("Only Emmanuel.A can run promotions 🔒"); return; }
    await sock.sendMessage(replyJid, { text: "🚀 Setting up campaign...", mentions });
    const allUsers = getAllCachedPhones();
    const result   = await runPromotion(sock, {
      text,
      devJid: senderJid,
      knownUsers: allUsers,
      groupJids,
    });
    await send(result.success ? result.message : `❌ ${result.error}`);
    await saveReply(`[Campaign: ${result.success ? "sent" : "failed"}]`);
    return;
  }

  // ── Email outreach ───────────────────────────────────────────────────────
  if (intent.type === "email") {
    if (!isDev) { await send("Only Emmanuel.A can send emails 🔒"); return; }
    const emailMatch = text.match(/to\s+([\w.+-]+@[\w.-]+\.\w{2,})/i);
    const emailAddr  = emailMatch?.[1];
    if (!emailAddr) { await send("Please include the email address — e.g: 'send email to client@company.com about...'"); return; }
    await sock.sendMessage(replyJid, { text: `📧 Sending email to ${emailAddr}...`, mentions });
    const subjMatch  = text.match(/subject[:\s]+([^\n]+)/i);
    const result     = await sendEmailOutreach({ to: emailAddr, subject: subjMatch?.[1], projectInfo: text });
    await send(result.success ? result.message : `❌ ${result.error}`);
    return;
  }

  // ── Status post ──────────────────────────────────────────────────────────
  if (intent.type === "status_post") {
    if (!isDev) { await send("Only Emmanuel.A can post statuses 🔒"); return; }
    const statusText = intent.prompt || text.replace(/post.*status|update.*status/gi, "").trim();
    const content    = await generateStatusContent(statusText || null);
    const ok         = await postStatus(content, process.env.TARGET_GROUP_JID);
    await send(ok ? `✅ Status posted!\n\n_"${content.slice(0, 100)}..."_` : "Status post failed. Check connection.");
    return;
  }

  // ── Code ─────────────────────────────────────────────────────────────────
  if (intent.type === "code") {
    const r = clean(await askGroq(sysPrompt + "\n\nWrite clean, working code. Use ``` formatting. Explain briefly. No padding.", text, history));
    await humanTyping(sock, replyJid, r?.length || 100);
    await sendSmart(sock, replyJid, r || "Could not generate code.", phone, mentions);
    await saveReply(r);
    return;
  }

  // ── Voice send ────────────────────────────────────────────────────────────
  if (intent.type === "voice_send") {
    const spoken = clean(await askGroq(
      sysPrompt + "\n\nGenerate a natural voice note response. Spoken words only — no markdown, no asterisks. Max 400 words.",
      text, history
    ));
    // Try TTS if available
    try {
      const { generateVoice } = require("./lumeo_voice");
      const vr = await generateVoice(spoken?.slice(0, 450) || text);
      if (vr?.success) {
        await sock.sendMessage(replyJid, { audio: vr.buffer, mimetype: "audio/ogg; codecs=opus", ptt: true });
        if (vr.cleanup) vr.cleanup();
        await saveReply(`[Voice]: ${spoken?.slice(0, 100)}`);
        return;
      }
    } catch {}
    await humanTyping(sock, replyJid, spoken?.length || 50);
    await sendSmart(sock, replyJid, (spoken || text) + "\n\n_🎤 Voice note unavailable_", phone, mentions);
    await saveReply(spoken);
    return;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // GENERAL CHAT
  // ══════════════════════════════════════════════════════════════════════════
  const chatSys = sysPrompt +
    (history.length > 2 ? "\n\nThis is an ONGOING conversation. Reply DIRECTLY — no greetings, no 'How can I help?'. Just respond to what was said." : "");

  const reply = clean(await askGroq(chatSys, text, history));
  if (!reply) { await send("Say that again?"); return; }

  await humanTyping(sock, replyJid, reply.length);
  await sendSmart(sock, replyJid, reply, phone, mentions);
  await saveReply(reply);
}

module.exports = { handleMessage };
