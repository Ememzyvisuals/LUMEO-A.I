/**
 * lumeo_core.js — Lumeo AI Brain
 * EMEMZYVISUALS DIGITALS | Emmanuel.A
 * Clean rebuild — all features, no corruption
 */
"use strict";

const { askGroq, generateImage, analyzeImage, transcribeAudio } = require("./ai");
const { getLumeoPrompt, shouldGreetDev, getDevGreeting, LUMEO_VERSION } = require("./personality");
const { getUser, updateUserName, addMemory, getHistory, clearMemory, cacheUser, getAllCachedPhones, checkRateLimit } = require("./lumeo_users");
const { downloadMedia }            = require("./lumeo_downloader");
const { createSticker }            = require("./lumeo_sticker");
const { createPDF }                = require("./lumeo_pdf");
const { generateWhatsAppScreenshot, parseScreenshotRequest } = require("./lumeo_screenshot");
const { runPromotion, sendEmailOutreach } = require("./lumeo_marketing");
const { startCompetition, handleGroupMessage } = require("./lumeo_competition");
const { postStatus, postImageStatus, postVideoStatus, postAudioStatus, generateStatusContent, getContactsForStatus } = require("./lumeo_status");

// ─── State ────────────────────────────────────────────────────────────────────
const _seen        = new Map();
const _voicePhones = new Set();
const _lastMsg     = new Map();
const _mutedGroups = new Map();

// ─── Helpers ──────────────────────────────────────────────────────────────────
function isVoice(phone) { return _voicePhones.has(phone); }

function clean(text) {
  if (!text) return "";
  return text
    .replace(/^(?:Certainly!?\s*|Of course!?\s*|Sure thing!?\s*|Absolutely!?\s*|Great question!?\s*)/i, "")
    .replace(/^(?:I'm doing (?:great|good|well)[^.!?]*[.!?]\s*)/i, "")
    .replace(/https?:\/\/example\.\S+/gi, "")
    .trim();
}

// ─── Intent classifier ────────────────────────────────────────────────────────
async function classifyIntent(text, history) {
  if (!text?.trim()) return { type: "chat", prompt: text };

  const ctx = history.slice(-6)
    .map(m => (m.role === "user" ? "User" : "Lumeo") + ": " + (m.content || "").slice(0, 120))
    .join("\n");

  const prompt =
    'Classify this WhatsApp message. Return ONLY valid JSON: {"type":"...", "prompt":"..."}\n\n' +
    "Context:\n" + (ctx || "none") + "\n\n" +
    'Message: "' + text + '"\n\n' +
    "TYPES:\n" +
    "- screenshot: HIGHEST PRIORITY — 'whatsapp screenshot', 'fake whatsapp', 'whatsapp chat screenshot'\n" +
    "- image_gen: create/draw/generate image/logo/art (NOT whatsapp screenshots)\n" +
    "- video_gen: create/make a video clip\n" +
    "- music_gen: compose/create a song or beat\n" +
    "- voice_send: speak something as voice note\n" +
    "- voice_mode_on: reply in voice notes from now on\n" +
    "- voice_mode_off: go back to text replies\n" +
    "- code: write/fix/explain code\n" +
    "- web_search: current news/prices/scores/weather\n" +
    "- download: download music/video by NAME or URL — any YouTube/TikTok/Instagram link\n" +
    "- sticker: convert image/video to WhatsApp sticker\n" +
    "- pdf: create a PDF document (receipt, letter, certificate, exam, CV)\n" +
    "- promote: promote/advertise/market a service to users/groups\n" +
    "- email: send email outreach to a specific address\n" +
    "- status_post: ANYTHING about posting to WhatsApp status — 'post status', 'post tech story', 'post on status', 'download music and post to status', 'post voice note on status', 'update status', 'post interesting fact', 'post image on status', 'market on status', 'post latest music on status'\n" +
    "- chat: everything else\n" +
    "- NEVER image_gen for 'whatsapp screenshot' — use screenshot\n" +
    "- NEVER image_gen for 'send me your pic' — use chat\n" +
    "Return ONLY the JSON.";

  try {
    const raw = await askGroq(
      "You classify WhatsApp messages into intents. Return ONLY valid JSON, nothing else.",
      prompt, []
    );
    const parsed = JSON.parse((raw || "{}").replace(/```json|```/g, "").trim());
    return { type: parsed.type || "chat", prompt: parsed.prompt || text };
  } catch {
    return { type: "chat", prompt: text };
  }
}

// ─── Human-like typing delay ──────────────────────────────────────────────────
async function humanTyping(sock, jid, len) {
  try {
    await sock.sendPresenceUpdate("composing", jid);
    const words = Math.ceil((len || 50) / 5);
    const delay = Math.min(Math.max(words * 180 + (Math.random() - 0.5) * 600, 600), 5000);
    await new Promise(r => setTimeout(r, delay));
    await sock.sendPresenceUpdate("paused", jid);
  } catch {}
}

// ─── Send message ─────────────────────────────────────────────────────────────
async function sendSmart(sock, jid, text, mentions) {
  if (!text || !jid) return;
  try {
    await sock.sendMessage(jid, { text, mentions: mentions || [] });
  } catch (e) {
    console.error("[Send] Failed:", jid?.split("@")[0], e.message?.slice(0, 60));
  }
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

  const replyJid = isGroup ? jid : senderJid;
  const mentions = isGroup ? [senderJid] : [];
  const send     = async (msg) => { if (msg) await sendSmart(sock, replyJid, msg, mentions); };

  // ── Cache user ──────────────────────────────────────────────────────────────
  cacheUser(phone, pushName);
  updateUserName(phone, pushName).catch(() => {});

  // ── Greet developer first message of the day ────────────────────────────────
  if (isDev && text && shouldGreetDev(phone)) {
    try { await sock.sendMessage(replyJid, { text: getDevGreeting(), mentions }); } catch {}
    await new Promise(r => setTimeout(r, 1200));
  }

  // ── Dedup ───────────────────────────────────────────────────────────────────
  if (text) {
    const key  = phone + "_" + text.slice(0, 50);
    const last = _seen.get(key);
    if (last && Date.now() - last < 3000) return;
    _seen.set(key, Date.now());
    if (_seen.size > 500) {
      const cut = Date.now() - 60000;
      for (const [k, t] of _seen) if (t < cut) _seen.delete(k);
    }
    const lp = _lastMsg.get(phone);
    if (lp && Date.now() - lp < 1000) return;
    _lastMsg.set(phone, Date.now());
  }

  // ── Mute check ──────────────────────────────────────────────────────────────
  if (isGroup && !isDev) {
    const muteUntil = _mutedGroups.get(jid);
    if (muteUntil && Date.now() < muteUntil) return;
    else if (muteUntil) _mutedGroups.delete(jid);
  }

  // ── Save incoming ───────────────────────────────────────────────────────────
  const memEntry = text || (hasAudio ? "[Voice note]" : hasDocument ? "[File: " + (documentName || "doc") + "]" : hasSticker ? "[Sticker]" : null);
  if (memEntry && !hasImage) await addMemory(phone, "user", memEntry);

  // ── Load history + build prompt ─────────────────────────────────────────────
  const history   = await getHistory(phone, 40);
  const userRec   = await getUser(phone);
  const nowWAT    = new Date().toLocaleString("en-NG", { timeZone: "Africa/Lagos", weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" });
  const recentCtx = history.slice(-12).map(m => (m.role === "user" ? (pushName || "User") : "Lumeo") + ": " + (m.content || "").slice(0, 200)).join("\n");

  const sysPrompt = getLumeoPrompt({
    isDev, isGroup, userName: pushName,
    language: "english",
    currentTime: nowWAT,
    recentHistory: recentCtx,
  });

  const saveReply = async (r) => { if (r) await addMemory(phone, "assistant", String(r).slice(0, 600)); };

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 1: AUDIO — transcribe → reprocess
  // ══════════════════════════════════════════════════════════════════════════
  if (hasAudio && audioBuffer) {
    console.log("[Lumeo] Transcribing audio...");
    const transcribed = await transcribeAudio(audioBuffer, audioMime || "audio/ogg");
    if (transcribed?.length > 2) {
      await addMemory(phone, "user", "[Voice]: " + transcribed);
      return handleMessage({ ...params, text: transcribed, hasAudio: false, audioBuffer: null });
    }
    return send("Didn't catch that — try typing it out?");
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 2: IMAGE
  // ══════════════════════════════════════════════════════════════════════════
  if (hasImage && imageBase64) {
    const q = text || "";

    if (/sticker|make.*sticker|convert.*sticker/i.test(q)) {
      await sock.sendMessage(replyJid, { text: "Converting to sticker...", mentions });
      const webp = await createSticker(Buffer.from(imageBase64, "base64"), imageMimeType || "image/jpeg");
      if (webp) { await sock.sendMessage(replyJid, { sticker: webp }); await saveReply("[Sticker created]"); }
      else await send("Couldn't convert — try a clearer image!");
      return;
    }

    const vision = await analyzeImage(imageBase64, imageMimeType || "image/jpeg", q || "Describe this image.");
    await addMemory(phone, "user", "[Image: " + (vision?.slice(0, 200) || "received") + (q ? " | " + q : "") + "]");
    const freshHistory = await getHistory(phone, 40);
    const reply = clean(await askGroq(sysPrompt + "\n\nYou are looking at an image. React naturally.", q || "Describe this image. Vision data: " + vision, freshHistory));
    await humanTyping(sock, replyJid, reply?.length || 50);
    await sendSmart(sock, replyJid, reply || "Nice one!", mentions);
    await saveReply(reply);
    return;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 3: STICKER
  // ══════════════════════════════════════════════════════════════════════════
  if (hasSticker) {
    const r = clean(await askGroq(sysPrompt + "\n\nSomeone sent a sticker. React naturally in 1-2 lines.", "React to sticker", history));
    await send(r || "😂");
    await saveReply(r);
    return;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 4: VIDEO
  // ══════════════════════════════════════════════════════════════════════════
  if (hasVideo) {
    if (/sticker|make.*sticker/i.test(text || "")) {
      await sock.sendMessage(replyJid, { text: "Converting video to sticker...", mentions });
      try {
        const { downloadContentFromMessage } = require("@whiskeysockets/baileys");
        if (videoMessage) {
          const stream = await downloadContentFromMessage(videoMessage, "video");
          const chunks = [];
          for await (const chunk of stream) chunks.push(chunk);
          const webp = await createSticker(Buffer.concat(chunks), "video/mp4");
          if (webp) { await sock.sendMessage(replyJid, { sticker: webp }); await saveReply("[Video sticker]"); return; }
        }
      } catch (e) { console.error("[VideoSticker]", e.message); }
      await send("Couldn't convert — try a clip under 5 seconds!");
      return;
    }
    if (text) {
      const r = clean(await askGroq(sysPrompt + "\n\nUser sent a video with caption. Respond to caption.", text, history));
      await humanTyping(sock, replyJid, r?.length || 50);
      await sendSmart(sock, replyJid, r || "Got it!", mentions);
      await saveReply(r);
    }
    return;
  }

  if (!text) return;

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 5: ADMIN COMMANDS (dev only — instant, no Groq needed)
  // ══════════════════════════════════════════════════════════════════════════
  if (isDev) {
    const t = text.trim().toLowerCase();

    if (t === "admin help" || t === ".help" || t === "!help") {
      await send(
        "*Lumeo Admin Commands*\n\n" +
        "*Downloads:*\n" +
        "Play [song name]\n" +
        "Download [YouTube/TikTok/IG link]\n\n" +
        "*AI Generate:*\n" +
        "Generate image of [desc]\n" +
        "Create video of [desc]\n" +
        "Make PDF [desc]\n" +
        "WhatsApp screenshot [convo]\n\n" +
        "*Marketing:*\n" +
        "promote [project] to all users\n" +
        "promote [project] to all groups\n" +
        "promote [project] to +234...\n" +
        "send email to x@y.com about [project]\n\n" +
        "*Status:*\n" +
        "post status [text]\n" +
        "post image status [desc]\n" +
        "post video status [desc]\n\n" +
        "*Voice:*\n" +
        "voice note mode — all replies as voice\n" +
        "text mode — back to text\n\n" +
        "*Admin:*\n" +
        "list users\n" +
        "clear memory\n" +
        "ping\n" +
        "mute [mins] — mute Lumeo in this group\n" +
        "unmute — unmute Lumeo"
      );
      return;
    }

    if (t === "ping" || t === ".ping") {
      await send(
        "LUMEO v" + LUMEO_VERSION + " alive!\n" +
        "Uptime: " + Math.floor(process.uptime() / 60) + "m\n" +
        "Memory: " + (process.memoryUsage().rss / 1024 / 1024).toFixed(0) + "MB\n" +
        "Node: " + process.version
      );
      return;
    }

    if (t === "list users" || t === "show users" || t === ".users") {
      const { dbGetAllUsers } = require("./lumeo_db");
      const dbUsers = await dbGetAllUsers().catch(() => []);
      const cached  = getAllCachedPhones();
      const all     = [...new Set([...dbUsers.map(u => u.phone), ...cached])];
      if (all.length === 0) { await send("No users yet. Wait for people to message Lumeo!"); return; }
      const lines = all.slice(0, 50).map((p, i) => {
        const u = dbUsers.find(x => x.phone === p);
        return (i + 1) + ". +" + p + (u?.name ? " — " + u.name : "") + (u?.banned ? " BANNED" : "");
      });
      await send("Known Users (" + all.length + "):\n\n" + lines.join("\n") + (all.length > 50 ? "\n...and " + (all.length - 50) + " more" : ""));
      return;
    }

    if (t === "clear memory" || t === "wipe memory" || t === ".clearmem") {
      await clearMemory(phone);
      await send("Memory cleared boss!");
      return;
    }

    if (t === "text mode" || t === "stop voice" || t === ".textmode") {
      _voicePhones.delete(phone);
      await send("Back to text mode!");
      return;
    }

    const muteMatch = text.match(/^mute\s+(\d+)/i);
    if (muteMatch && isGroup) {
      const mins = parseInt(muteMatch[1]);
      _mutedGroups.set(jid, Date.now() + mins * 60000);
      await send("Muted for " + mins + " minutes. Use 'unmute' to wake me up.");
      return;
    }

    if (t === "unmute" && isGroup) {
      _mutedGroups.delete(jid);
      await send("I'm back! Ready to chat.");
      return;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ROUTE 6: TEXT — classify → route
  // ══════════════════════════════════════════════════════════════════════════
  // Fast-path: detect status commands without AI classification
  let intent;
  if (/\bpost\b.*(status|story|music|song|image|video|voice|fact|tech|update)|status.*\b(post|update|story|music|fact)|download.*post|latest.*status/i.test(text) && isDev) {
    intent = { type: "status_post", prompt: text };
    console.log("[Lumeo] Fast-path: status_post");
  } else {
    intent = await classifyIntent(text, history);
  }
  console.log("[Lumeo] Intent: " + intent.type + " | \"" + text.slice(0, 60) + "\" | Phone: " + phone);

  // ── Voice mode on/off ────────────────────────────────────────────────────
  if (intent.type === "voice_mode_on") {
    _voicePhones.add(phone);
    await send("Voice note mode on! I'll reply in voice notes now.");
    await saveReply("[Voice mode ON]");
    return;
  }
  if (intent.type === "voice_mode_off") {
    _voicePhones.delete(phone);
    await send("Back to text replies!");
    await saveReply("[Voice mode OFF]");
    return;
  }

  // ── Screenshot ───────────────────────────────────────────────────────────
  if (intent.type === "screenshot") {
    await sock.sendMessage(replyJid, { text: "Creating WhatsApp screenshot...", mentions });
    try {
      const ssText = intent.prompt || text;
      const convFormatted = await askGroq(
        "Format this as a WhatsApp conversation. Return ONLY lines like:\nName: message\nMe: message\nUse names given or 'Me' and 'Friend'.",
        ssText, []
      );
      const { messages, contact } = parseScreenshotRequest(convFormatted || ssText);
      if (!messages.length) { await send("Tell me the conversation:\nJohn: Hey!\nMe: What's up?"); return; }
      const themeM = /dark/i.test(ssText) ? "dark" : "light";
      const result = await generateWhatsAppScreenshot(messages, { theme: themeM, contact });
      if (result?.success) {
        await sock.sendMessage(replyJid, { image: result.buffer, caption: "WhatsApp screenshot (" + themeM + " mode)", mimetype: "image/png" });
        await saveReply("[Screenshot generated]");
      } else { await send("Screenshot failed. Try again!"); }
    } catch (e) { console.error("[Screenshot]", e.message); await send("Screenshot error. Try again!"); }
    return;
  }

  // ── Image generation ─────────────────────────────────────────────────────
  if (intent.type === "image_gen") {
    await sock.sendMessage(replyJid, { text: "On it...", mentions });
    const buf = await generateImage(intent.prompt || text);
    if (buf) {
      await sock.sendMessage(replyJid, { image: buf, caption: "Here you go!", mimetype: "image/jpeg" });
      await saveReply("[Image: " + (intent.prompt || text).slice(0, 80) + "]");
    } else { await send("Image generation failed. Try again!"); }
    return;
  }

  // ── Video generation ─────────────────────────────────────────────────────
  if (intent.type === "video_gen") {
    await sock.sendMessage(replyJid, { text: "Creating that video...", mentions });
    setImmediate(async () => {
      try {
        const { generateVideo } = require("./lumeo_video");
        const r = await generateVideo(intent.prompt || text);
        if (r?.success && r.buffer) {
          await sock.sendMessage(replyJid, { video: r.buffer, mimetype: "video/mp4", fileName: "lumeo_video.mp4", caption: "Here's your video!" });
          await saveReply("[Video generated]");
          if (r.cleanup) r.cleanup();
        } else { await send("Video generation failed. Try again!"); }
      } catch (e) { console.error("[VideoGen]", e.message); await send("Video error. Try again!"); }
    });
    return;
  }

  // ── Music generation ─────────────────────────────────────────────────────
  if (intent.type === "music_gen") {
    await sock.sendMessage(replyJid, { text: "Composing that...", mentions });
    setImmediate(async () => {
      try {
        const { generateMusic } = require("./lumeo_music");
        const r = await generateMusic(intent.prompt || text);
        if (r?.hasAudio && r.buffer) {
          await sock.sendMessage(replyJid, { audio: r.buffer, mimetype: "audio/mpeg", fileName: (r.title || "Lumeo") + ".mp3", caption: r.title || "Your track!" });
          await saveReply("[Music: " + (intent.prompt || text).slice(0, 60) + "]");
          if (r.cleanup) r.cleanup();
        } else { await send("Music generation failed. Try again!"); }
      } catch (e) { await send("Music error. Try again!"); }
    });
    return;
  }

  // ── Download ─────────────────────────────────────────────────────────────
  if (intent.type === "download") {
    const { detectPlatform, cleanQuery } = require("./lumeo_downloader");
    const isVid = /video|movie|film|series|episode|show|clip|reel/i.test(text);
    const { isUrl, platform } = detectPlatform(text);
    const searchQ = cleanQuery(text);

    let ackMsg;
    if (isUrl) {
      const pn = { youtube: "YouTube", tiktok: "TikTok", instagram: "Instagram", twitter: "Twitter", facebook: "Facebook", soundcloud: "SoundCloud" };
      ackMsg = "Downloading from " + (pn[platform] || "link") + "...";
    } else if (isVid) {
      ackMsg = "Searching for \"" + searchQ + "\"...";
    } else {
      ackMsg = "Searching SoundCloud for \"" + searchQ + "\"...";
    }
    await sock.sendMessage(replyJid, { text: ackMsg, mentions });

    setImmediate(async () => {
      try {
        const result = await downloadMedia(text, isVid ? "video" : "music");
        if (!result?.success) { await send(result?.error || "Couldn't download that. Check the link or try a different search!"); return; }

        if (result.thumbBuf) {
          try {
            await sock.sendMessage(replyJid, { image: result.thumbBuf, caption: "*" + (result.title || searchQ) + "*", mimetype: "image/jpeg" });
            await new Promise(r => setTimeout(r, 800));
          } catch {}
        }

        if (result.videoBuf) {
          await sock.sendMessage(replyJid, { video: result.videoBuf, mimetype: "video/mp4", fileName: searchQ.slice(0, 40) + ".mp4", caption: "Here's your video!" });
        } else if (result.audioBuf) {
          const trackName = (result.title || searchQ).slice(0, 60);
          await sock.sendMessage(replyJid, { audio: result.audioBuf, mimetype: "audio/mpeg", fileName: trackName.replace(/[^a-z0-9 ]/gi, "_") + ".mp3", caption: trackName });

          // Send lyrics
          const GENIUS = (process.env.GENIUS_KEY || "").trim();
          if (GENIUS) {
            try {
              const https = require("https");
              const gData = await new Promise(res => {
                const req = https.get({ hostname: "api.genius.com", path: "/search?q=" + encodeURIComponent(trackName), headers: { "Authorization": "Bearer " + GENIUS }, timeout: 8000 }, r => {
                  let d = ""; r.on("data", c => d += c); r.on("end", () => { try { res(JSON.parse(d)); } catch { res(null); } });
                });
                req.on("error", () => res(null)); req.on("timeout", () => { req.destroy(); res(null); });
              });
              const hit = gData?.response?.hits?.[0]?.result;
              if (hit?.url) await sock.sendMessage(replyJid, { text: "*Lyrics — " + hit.title + "*\n" + hit.url, mentions: [] });
              else await sock.sendMessage(replyJid, { text: "Lyrics: https://www.google.com/search?q=" + encodeURIComponent(trackName + " lyrics"), mentions: [] });
            } catch { await sock.sendMessage(replyJid, { text: "Lyrics: https://www.google.com/search?q=" + encodeURIComponent(trackName + " lyrics"), mentions: [] }); }
          } else {
            await sock.sendMessage(replyJid, { text: "Lyrics: https://www.google.com/search?q=" + encodeURIComponent(trackName + " lyrics"), mentions: [] });
          }
        }

        await saveReply("[Downloaded: " + searchQ + "]");
        if (result.cleanup) result.cleanup();
      } catch (e) { console.error("[Download]", e.message); await send("Download error. Try again!"); }
    });
    return;
  }

  // ── Sticker (no media attached) ──────────────────────────────────────────
  if (intent.type === "sticker") {
    await send("Send me an image or video with caption 'make sticker'!");
    return;
  }

  // ── PDF ──────────────────────────────────────────────────────────────────
  if (intent.type === "pdf") {
    await sock.sendMessage(replyJid, { text: "Creating your PDF...", mentions });
    try {
      const isLong = text.length > 150;
      let docContent, docTitle;
      if (isLong) {
        docContent = await askGroq("Format this content into a professional document. Keep ALL info. Clear section headings. Plain text only, no markdown symbols.", text, []) || text;
        docTitle   = text.split("\n").find(l => l.trim().length > 3 && l.trim().length < 80)?.trim() || "Document";
      } else {
        docContent = await askGroq(sysPrompt + "\n\nGenerate complete professional document content. Clear headings. Plain text. Be thorough.", text, history) || text;
        docTitle   = clean(await askGroq("Return ONLY a document title, max 6 words, nothing else.", "Title for: " + text.slice(0, 100), [])) || "Lumeo Document";
      }
      const result = await createPDF(docContent, docTitle);
      if (result?.success && result.buffer?.length > 500) {
        await sock.sendMessage(replyJid, { document: result.buffer, mimetype: "application/pdf", fileName: result.filename, caption: "*" + docTitle + "*\nGenerated by Lumeo AI" });
        await saveReply("[PDF: " + docTitle + "]");
      } else { await send("PDF creation failed. Try again!"); }
    } catch (e) { console.error("[PDF]", e.message); await send("PDF error. Try again!"); }
    return;
  }

  // ── Promote ──────────────────────────────────────────────────────────────
  if (intent.type === "promote") {
    if (!isDev) { await send("Only Emmanuel.A can run promotions."); return; }
    await sock.sendMessage(replyJid, { text: "Setting up campaign...", mentions });
    const result = await runPromotion(sock, { text, devJid: senderJid, knownUsers: getAllCachedPhones(), groupJids });
    await send(result.success ? result.message : "Campaign failed: " + result.error);
    await saveReply("[Campaign: " + (result.success ? "sent" : "failed") + "]");
    return;
  }

  // ── AI Competition (fully automated) ──────────────────────────────────────
  if (intent.type === "competition" || (isDev && /start competition|ai.*vs.*ai|ai.*battle/i.test(text))) {
    if (!isDev) { await send("Only Emmanuel.A can start competitions."); return; }
    if (!isGroup) { await send("Competitions only work in group chats!"); return; }
    const topic = text.replace(/start competition[:\s]*/i, "").trim() || "Technology and AI";
    await send("Starting Lumeo vs Meta AI competition! 3 rounds, fully automated. Stand by... 🔥");
    setImmediate(() => { startCompetition(sock, jid, topic, sysPrompt, mentions).catch(e => console.error("[Comp]", e.message)); });
    await saveReply("[Competition started: " + topic + "]");
    return;
  }

  // ── Email  ────────────────────────────────────────────────────────────────
  if (intent.type === "email") {
    if (!isDev) { await send("Only Emmanuel.A can send emails."); return; }
    const emailMatch = text.match(/[\w.+-]+@[\w.-]+\.\w{2,}/i);
    const emailAddr  = emailMatch?.[0];
    if (!emailAddr) { await send("Include the email address — e.g: 'send email to client@company.com about...'"); return; }
    await sock.sendMessage(replyJid, { text: "Sending email to " + emailAddr + "...", mentions });
    const subjMatch = text.match(/subject[:\s]+([^\n]+)/i);
    const result    = await sendEmailOutreach({ to: emailAddr, subject: subjMatch?.[1], projectInfo: text });
    await send(result.success ? result.message : "Email failed: " + result.error);
    return;
  }

  // ── Status post ──────────────────────────────────────────────────────────
  if (intent.type === "status_post") {
    if (!isDev) { await send("Only Emmanuel.A can post statuses."); return; }
    const rawStatus = (intent.prompt || text).trim();
    const tl = rawStatus.toLowerCase();

    // Music download then post to status
    if (/download.*status|music.*status|song.*status|latest.*music|post.*song/i.test(rawStatus)) {
      await send("Downloading music for status...");
      const songQ = rawStatus.replace(/download|post|on.*status|to.*status|status|music|song|latest/gi,"").trim() || "Afrobeats hit 2025";
      const dl = await downloadMedia(songQ, "music");
      if (dl?.success && dl.audioBuf) {
        const ok = await postAudioStatus(dl.audioBuf, "audio/mpeg");
        if (ok) await postStatus("Now playing: *" + (dl.title || songQ) + "* — shared via Lumeo AI 🎵\nEMEMZYVISUALS DIGITALS");
        await send(ok ? "Music posted to status!" : "Couldn't post audio status.");
        if (dl.cleanup) dl.cleanup();
      } else { await send("Couldn't download that song."); }
      return;
    }

    // Voice note to status
    if (/voice.*status|audio.*status|voice.*note.*status|status.*voice/i.test(rawStatus)) {
      await send("Generating voice for status...");
      const { generateVoice } = require("./lumeo_voice");
      const voiceText = rawStatus.replace(/post|voice.*note|voice|audio|on.*status|to.*status|status/gi,"").trim()
        || "EMEMZYVISUALS DIGITALS — building world-class AI and digital solutions from Nigeria.";
      const vr = await generateVoice(String(voiceText).slice(0, 400));
      if (vr?.success) {
        const ok = await postAudioStatus(vr.buffer, "audio/ogg; codecs=opus");
        await send(ok ? "Voice note posted to status!" : "Audio status failed.");
        if (vr.cleanup) vr.cleanup();
      } else { await send("Voice generation failed — check Groq terms at console.groq.com"); }
      return;
    }

    // Tech story / fact / interesting content
    if (/tech.*story|story|interesting|fact|tips?|knowledge|post.*about/i.test(rawStatus)) {
      const topic = rawStatus.replace(/post|tech.*story|story|interesting|fact|tips?|knowledge|about|on.*status|to.*status|status/gi,"").trim() || "technology trends";
      const story = await askGroq(
        "Write a punchy WhatsApp status (max 180 chars). English. Interesting tech fact or insight relevant to Nigeria and Africa. End with EMEMZYVISUALS DIGITALS.",
        "Topic: " + topic, []
      );
      const ok = await postStatus(story || await generateStatusContent(topic));
      await send(ok ? "Tech story posted!" : "Status failed.");
      return;
    }

    // Image to status
    if (/image.*status|status.*image|generate.*image|photo.*status/i.test(rawStatus)) {
      await send("Generating image for status...");
      const desc = rawStatus.replace(/generate|post|image|photo|on.*status|to.*status|status/gi,"").trim()
        || "EMEMZYVISUALS DIGITALS AI technology professional vibrant";
      const img = await generateImage(desc);
      if (img) {
        const cap = await generateStatusContent();
        const ok = await postImageStatus(img, cap);
        await send(ok ? "Image posted to status!" : "Failed — no contacts loaded yet.");
      } else { await send("Image generation failed."); }
      return;
    }

    // Video to status
    if (/video.*status|status.*video|generate.*video/i.test(rawStatus)) {
      await send("Creating video for status (2 mins)...");
      const { generateVideo } = require("./lumeo_video");
      const desc = rawStatus.replace(/generate|post|video|on.*status|to.*status|status/gi,"").trim()
        || "EMEMZYVISUALS DIGITALS digital agency promotion";
      const vr = await generateVideo(desc);
      if (vr?.success) {
        const ok = await postVideoStatus(vr.buffer, await generateStatusContent());
        await send(ok ? "Video posted to status!" : "Video status failed.");
        if (vr.cleanup) vr.cleanup();
      } else { await send("Video generation failed."); }
      return;
    }

    // Plain text status
    const sc = await generateStatusContent(rawStatus.replace(/post.*status|update.*status|post status/gi,"").trim() || null);
    const ok = await postStatus(sc);
    await send(ok
      ? "Status posted!\n\n\"" + sc.slice(0, 100) + (sc.length > 100 ? "..." : "") + "\""
      : "Status failed — send a message to the group first so contacts are loaded, then retry."
    );
    return;
  }

  // ── Code ─────────────────────────────────────────────────────────────────
  // ── Code ─────────────────────────────────────────────────────────────────
  if (intent.type === "code") {
    const r = clean(await askGroq(sysPrompt + "\n\nWrite clean working code. Use ``` blocks. Explain briefly.", text, history));
    await humanTyping(sock, replyJid, r?.length || 100);
    await sendSmart(sock, replyJid, r || "Could not generate code.", mentions);
    await saveReply(r);
    return;
  }

  // ── Voice send ────────────────────────────────────────────────────────────
  if (intent.type === "voice_send") {
    const spoken = clean(await askGroq(sysPrompt + "\n\nGenerate a natural spoken voice note response. No markdown. No asterisks. Max 200 words.", text, history));
    try {
      const { generateVoice } = require("./lumeo_voice");
      const vr = await generateVoice(spoken?.slice(0, 450) || text);
      if (vr?.success) {
        await sock.sendMessage(replyJid, { audio: vr.buffer, mimetype: "audio/ogg; codecs=opus", ptt: true });
        if (vr.cleanup) vr.cleanup();
        await saveReply("[Voice]: " + (spoken || text).slice(0, 100));
        return;
      }
    } catch (e) { console.error("[VoiceSend]", e.message); }
    await humanTyping(sock, replyJid, spoken?.length || 50);
    await sendSmart(sock, replyJid, (spoken || text) + "\n\n_(Voice note unavailable)_", mentions);
    await saveReply(spoken);
    return;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // GENERAL CHAT
  // ══════════════════════════════════════════════════════════════════════════
  const chatSys = sysPrompt + (history.length > 2 ? "\n\nOngoing conversation — reply directly, no greetings." : "");
  const reply   = clean(await askGroq(chatSys, text, history));
  if (!reply) { await send("Say that again?"); return; }

  await humanTyping(sock, replyJid, reply.length);

  // If voice mode is on, send as voice note
  if (isVoice(phone)) {
    try {
      const { generateVoice } = require("./lumeo_voice");
      const vr = await generateVoice(reply.replace(/[*_~`]/g, "").slice(0, 600));
      if (vr?.success) {
        await sock.sendMessage(replyJid, { audio: vr.buffer, mimetype: "audio/ogg; codecs=opus", ptt: true });
        if (vr.cleanup) vr.cleanup();
        await saveReply(reply);
        return;
      }
    } catch (e) { console.error("[VoiceMode]", e.message); }
    // Fallback to text if TTS fails
  }

  await sendSmart(sock, replyJid, reply, mentions);
  await saveReply(reply);
}

module.exports = { handleMessage };
