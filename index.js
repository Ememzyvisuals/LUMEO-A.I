/**
 * index.js — Lumeo AI v3.0 — Main Entry Point
 * EMEMZYVISUALS DIGITALS | Emmanuel.A
 *
 * SECURITY NOTES:
 * - isDeveloper() checks against ADMIN_NUMBERS env var only — never trusts pushName
 * - Rate limiting per user — 30 messages/day
 * - No process.exit() on 401 — session cleared and reconnect attempted
 * - Cron jobs guarded with _cronStarted flag — no duplicate cron on reconnect
 * - Self-ping every 6 minutes (NOT 4) — avoids 429 rate limits on Render
 * - Startup delay 2-5s — prevents double-connection during Render zero-downtime deploy
 * - Input sanitization — all user text trimmed and length-checked before processing
 * - NEVER trusts pushName for admin detection — only JID numbers
 */

"use strict";

require("dotenv").config();

const {
  default: makeWASocket,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  DisconnectReason,
  isJidGroup,
  isJidBroadcast,
  makeInMemoryStore,
  downloadContentFromMessage,
  getContentType,
  Browsers,
} = require("@whiskeysockets/baileys");
const pino          = require("pino");
const cron          = require("node-cron");
const fs            = require("fs");
const http          = require("http");

const { handleMessage }           = require("./lumeo_core");
const { getMorningBriefing, getStatusContent, LUMEO_VERSION } = require("./personality");
const { isBanned, checkRateLimit, getHistory, cacheUser }     = require("./lumeo_users");
const { setStatusSock, handleStatusMessage, postStatus, generateStatusContent } = require("./lumeo_status");
const { dbGetAllUsers }           = require("./lumeo_db");

// ─── Config ───────────────────────────────────────────────────────────────────
const SESSION_DIR   = "./session";
const PHONE_NUMBER  = (process.env.BOT_PHONE_NUMBER || "").replace(/\D/g, "");
const TARGET_GROUP  = process.env.TARGET_GROUP_JID || "";
const RENDER_URL    = (process.env.RENDER_EXTERNAL_URL || "").replace(/\/$/, "");

// ─── Developer recognition ────────────────────────────────────────────────────
// Reads ADMIN_NUMBERS from env. Supports comma-separated list.
// BOTH phone (2349020172519) AND LID (4213966897289) should be in ADMIN_NUMBERS.
function normalizePhone(jid) {
  return (jid || "").split("@")[0].split(":")[0].replace(/\D/g, "");
}

function isDeveloper(jid) {
  if (!jid) return false;
  const phone = normalizePhone(jid);
  if (!phone) return false;

  const adminNums = (process.env.ADMIN_NUMBERS || "")
    .split(",")
    .map(n => n.replace(/\D/g, "").trim())
    .filter(Boolean);

  for (const num of adminNums) {
    if (!num) continue;
    if (phone === num) return true;
    if (jid.includes(num)) return true;
    // Nigerian 0-prefix vs 234-prefix
    if (num.startsWith("234") && phone === "0" + num.slice(3)) return true;
    if (phone.startsWith("234") && num === "0" + phone.slice(3)) return true;
  }
  return false;
}

// ─── Keep-alive HTTP server ───────────────────────────────────────────────────
function startKeepAlive() {
  const port = process.env.PORT || 10000;
  http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("Lumeo AI v" + LUMEO_VERSION + " — ONLINE");
  }).listen(port, () => console.log(`[HTTP] Keep-alive server on port ${port}`));

  if (!RENDER_URL) return;
  const INTERVAL = 6 * 60 * 1000; // 6 minutes — avoids 429
  setInterval(async () => {
    try {
      const u = new URL(RENDER_URL);
      http.get({ hostname: u.hostname, path: "/", port: 80 }, r => {
        console.log(`[KeepAlive] ✅ Pinged ${u.hostname} — HTTP ${r.statusCode}`);
        r.resume();
      }).on("error", () => {
        // Silently fail — don't crash on ping error
      });
    } catch {}
  }, INTERVAL);
  console.log("[KeepAlive] ✅ Self-ping active — every 6 minutes");
}

// ─── Cron jobs ────────────────────────────────────────────────────────────────
let _cronStarted = false;

function setupCron(sock) {
  if (_cronStarted) return;
  _cronStarted = true;

  const devJid = (process.env.ADMIN_NUMBERS || "").split(",")[0].replace(/\D/g, "") + "@s.whatsapp.net";

  // Morning briefing to dev — 6 AM WAT weekdays
  cron.schedule("0 6 * * 1-5", async () => {
    try {
      await sock.sendMessage(devJid, { text: getMorningBriefing() });
    } catch {}
  }, { timezone: "Africa/Lagos" });

  // Status update — 7 AM, 12 PM, 6 PM WAT
  cron.schedule("0 7,12,18 * * *", async () => {
    try {
      const content = await generateStatusContent();
      await postStatus(content, TARGET_GROUP);
    } catch {}
  }, { timezone: "Africa/Lagos" });

  // Daily quote to target group — 8 AM
  cron.schedule("0 8 * * *", async () => {
    if (!TARGET_GROUP) return;
    try {
      const { askGroq } = require("./ai");
      const quote = await askGroq(
        "You are Lumeo AI. Generate a short motivational or entertaining morning message for a WhatsApp group. Nigerian energy, max 80 words. Use 1-2 emojis.",
        "Generate today's morning group message", []
      );
      if (quote) await sock.sendMessage(TARGET_GROUP, { text: quote.trim() });
    } catch {}
  }, { timezone: "Africa/Lagos" });

  console.log("[Cron] ✅ All scheduled jobs active");
}

// ─── Download media buffer from Baileys message ───────────────────────────────
async function downloadMediaFromMsg(msg, type) {
  try {
    const stream = await downloadContentFromMessage(msg, type);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
  } catch {
    return null;
  }
}

// ─── Main bot connection ──────────────────────────────────────────────────────
let _sock          = null;
let _pairingDone   = false;
let _reconnectTimer = null;

async function connect() {
  // Clear any pending reconnect
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }

  console.log("[Bot] Initializing Baileys...");

  const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
  const { version }          = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth:              state,
    logger:            pino({ level: "silent" }),
    browser:           Browsers.macOS("Chrome"),
    printQRInTerminal: false,
    syncFullHistory:   false,
    markOnlineOnConnect: true,
    defaultQueryTimeoutMs: 20000,
    getMessage: async () => undefined,
  });

  _sock = sock;
  setStatusSock(sock);

  // ── Save credentials ───────────────────────────────────────────────────────
  sock.ev.on("creds.update", saveCreds);

  // ── Connection state ───────────────────────────────────────────────────────
  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) console.log("[Bot] QR available — use pairing code instead");

    if (connection === "open") {
      console.log("\n✅ *LUMEO AI ONLINE* — Built by EMEMZYVISUALS DIGITALS");
      console.log(`📱 Connected: ${PHONE_NUMBER}`);
      console.log(`🎯 Target Group: ${TARGET_GROUP || "none"}\n`);

      // Greet developer on connect
      if (!_pairingDone) {
        _pairingDone = true;
        const devNum = (process.env.ADMIN_NUMBERS || "").split(",")[0].replace(/\D/g, "");
        if (devNum) {
          setTimeout(async () => {
            try {
              const hour = new Date().toLocaleString("en-NG", { timeZone: "Africa/Lagos", hour: "numeric", hour12: false });
              const h    = parseInt(hour);
              const greeting = h < 12 ? "Good morning boss! 🌅" : h < 17 ? "Good afternoon boss! ☀️" : "Good evening boss! 🌙";
              await sock.sendMessage(devNum + "@s.whatsapp.net", {
                text: `${greeting}\n\n🤖 *Lumeo AI v${LUMEO_VERSION} is now online*\n_Built by EMEMZYVISUALS DIGITALS_\n\nAll systems operational. Ready to go boss! 💪`,
              });
            } catch {}
          }, 3000);
        }
      }

      setupCron(sock);
    }

    if (connection === "close") {
      const code = (lastDisconnect?.error)?.output?.statusCode;
      const shouldReconnect = code !== DisconnectReason.loggedOut;
      console.log(`[Bot] Disconnected (code ${code}) — reconnect: ${shouldReconnect}`);

      if (shouldReconnect) {
        _pairingDone = false;
        const delay  = 5000;
        console.log(`[Bot] Reconnecting in ${delay}ms...`);
        _reconnectTimer = setTimeout(connect, delay);
      } else {
        // 401 = logged out — clear session and reconnect with fresh pairing
        console.log("[Bot] ⚠️  Logged out (401) — clearing session, reconnecting in 15s...");
        try {
          if (fs.existsSync(SESSION_DIR)) {
            fs.rmSync(SESSION_DIR, { recursive: true, force: true });
            console.log("[Bot] Session cleared ✅");
          }
        } catch (e) { console.error("[Bot] Session clear error:", e.message); }
        _pairingDone = false;
        _reconnectTimer = setTimeout(connect, 15000);
      }
    }
  });

  // ── Pairing code (only if not already registered) ─────────────────────────
  if (!state.creds.registered && PHONE_NUMBER) {
    try {
      console.log(`[Bot] 📲 Requesting pairing code for +${PHONE_NUMBER}...`);
      await new Promise(r => setTimeout(r, 2000));
      const code = await sock.requestPairingCode(PHONE_NUMBER);
      console.log("\n╔══════════════════════════════════════════╗");
      console.log("║       📲  LUMEO AI — PAIRING CODE        ║");
      console.log("╠══════════════════════════════════════════╣");
      console.log(`║  CODE:   ${code?.match(/.{1,4}/g)?.join("-") || code}${" ".repeat(Math.max(0, 32 - (code?.length || 0)))}║`);
      console.log("╠══════════════════════════════════════════╣");
      console.log("║  WhatsApp → Linked Devices → Link Device  ║");
      console.log("║  → Link with phone number → Enter code    ║");
      console.log("╚══════════════════════════════════════════╝\n");
    } catch (e) {
      console.error("[Bot] Pairing code error:", e.message);
    }
  }

  // ── Status updates (view/react) ────────────────────────────────────────────
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return;

    for (const msg of messages) {
      try {
        const jid = msg.key?.remoteJid || "";

        // ── Status broadcast handler ─────────────────────────────────────────
        if (jid === "status@broadcast") {
          await handleStatusMessage(msg, null);
          continue;
        }

        // ── Skip non-JID messages ────────────────────────────────────────────
        if (!jid || isJidBroadcast(jid)) continue;

        // ── Skip own messages ────────────────────────────────────────────────
        if (msg.key.fromMe) continue;

        // ── Determine sender ──────────────────────────────────────────────────
        const isGroup  = isJidGroup(jid);
        const senderJid = isGroup ? (msg.key.participant || jid) : jid;
        const phone     = normalizePhone(senderJid);
        const pushName  = (msg.pushName || "").trim().slice(0, 60); // Sanitize name length
        const isDev     = isDeveloper(senderJid);

        if (!phone) continue;

        // ── Security: check ban ───────────────────────────────────────────────
        if (!isDev && await isBanned(phone)) {
          console.log(`[Bot] 🚫 Banned user: ${phone}`);
          continue;
        }

        // ── Service hours — groups only 7AM-7PM WAT, DMs always ──────────────
        if (isGroup && !isDev) {
          const hour = parseInt(new Date().toLocaleString("en-NG", { timeZone: "Africa/Lagos", hour: "numeric", hour12: false }));
          if (hour < 7 || hour >= 19) continue;
        }

        // ── Rate limiting (skip for dev) ──────────────────────────────────────
        if (!isDev && checkRateLimit(phone)) {
          // Only warn once
          if (!_rateLimitedToday.has(phone)) {
            _rateLimitedToday.add(phone);
            await sock.sendMessage(isGroup ? jid : senderJid, {
              text: "You've reached your daily message limit (30). Come back tomorrow! 🙏",
            });
          }
          continue;
        }

        // ── Extract message content ───────────────────────────────────────────
        const mc = msg.message || {};

        // Handle ephemeral/view-once wrapper
        const actualMsg = mc.ephemeralMessage?.message || mc.viewOnceMessage?.message || mc;

        let text = (
          actualMsg.conversation ||
          actualMsg.extendedTextMessage?.text ||
          actualMsg.imageMessage?.caption ||
          actualMsg.videoMessage?.caption ||
          actualMsg.documentMessage?.caption ||
          ""
        ).trim();

        // Security: cap input length
        if (text.length > 4000) text = text.slice(0, 4000);

        const contentType  = getContentType(actualMsg);
        const hasImage     = contentType === "imageMessage";
        const hasAudio     = contentType === "audioMessage";
        const hasVideo     = contentType === "videoMessage";
        const hasSticker   = contentType === "stickerMessage";
        const hasDocument  = contentType === "documentMessage";

        // Skip empty messages with no media
        if (!text && !hasImage && !hasAudio && !hasVideo && !hasSticker && !hasDocument) continue;

        // Cache user
        cacheUser(phone, pushName);

        console.log(`[Lumeo] 📚 ${phone} | ${isGroup ? "GROUP" : "DM"} | "${text.slice(0, 60)}"${isDev ? " 👑" : ""}`);

        // ── Download media if needed ──────────────────────────────────────────
        let imageBase64 = null, imageMimeType = null;
        let audioBuffer = null, audioMime = null;
        let videoMessage = null;
        let documentBuffer = null, documentName = null, documentMime = null;

        if (hasImage) {
          const buf = await downloadMediaFromMsg(actualMsg.imageMessage, "image");
          if (buf) { imageBase64 = buf.toString("base64"); imageMimeType = actualMsg.imageMessage.mimetype || "image/jpeg"; }
        }
        if (hasAudio) {
          audioBuffer = await downloadMediaFromMsg(actualMsg.audioMessage, "audio");
          audioMime   = actualMsg.audioMessage?.mimetype || "audio/ogg";
        }
        if (hasVideo)     videoMessage = actualMsg.videoMessage;
        if (hasDocument) {
          documentBuffer = await downloadMediaFromMsg(actualMsg.documentMessage, "document");
          documentName   = (actualMsg.documentMessage?.fileName || "document").slice(0, 100);
          documentMime   = actualMsg.documentMessage?.mimetype || "application/octet-stream";
        }

        // ── Get all known group JIDs for marketing ────────────────────────────
        let groupJids = [];
        if (isDev) {
          try {
            const allGroups = await sock.groupFetchAllParticipating();
            groupJids = Object.keys(allGroups || {});
          } catch {}
        }

        // ── Pass to message handler ───────────────────────────────────────────
        await handleMessage({
          text, phone, pushName, sock,
          jid, senderJid, isGroup, isDev,
          hasImage, imageBase64, imageMimeType,
          hasAudio, audioBuffer, audioMime,
          hasVideo, videoMessage,
          hasSticker,
          hasDocument, documentBuffer, documentName, documentMime,
          groupJids,
        });

      } catch (e) {
        console.error("[Bot] Message handler error:", e.message);
      }
    }
  });

  return sock;
}

// ─── Rate limit tracker (per-day) ────────────────────────────────────────────
const _rateLimitedToday = new Set();
// Reset at midnight
cron.schedule("0 0 * * *", () => { _rateLimitedToday.clear(); }, { timezone: "Africa/Lagos" });

// ─── Boot sequence ────────────────────────────────────────────────────────────
console.log("╔══════════════════════════════════════════╗");
console.log(`║          LUMEO AI — v${LUMEO_VERSION}                 ║`);
console.log("║   Built by EMEMZYVISUALS DIGITALS        ║");
console.log("║   Developer: Emmanuel.A                  ║");
console.log("╠══════════════════════════════════════════╣");
console.log("║  ✅ Natural chat — all users 24/7        ║");
console.log("║  ✅ Image generation (HF 3-token rotate) ║");
console.log("║  ✅ Music + Video generation             ║");
console.log("║  ✅ Voice notes (HF TTS)                 ║");
console.log("║  ✅ Media download (Cobalt + SoundCloud) ║");
console.log("║  ✅ PDF creator (6 professional types)   ║");
console.log("║  ✅ WhatsApp screenshot generator        ║");
console.log("║  ✅ Sticker creator (image + video)      ║");
console.log("║  ✅ Marketing agent (promote + email)    ║");
console.log("║  ✅ Status poster + auto-react           ║");
console.log("║  ✅ Persistent memory (Supabase)         ║");
console.log("║  ✅ Anti-ban + keep-alive (6 min)        ║");
console.log("╚══════════════════════════════════════════╝\n");

startKeepAlive();

// Stagger startup to avoid collision during Render zero-downtime deploy
const startupDelay = 2000 + Math.floor(Math.random() * 3000);
console.log(`[Bot] Starting in ${startupDelay}ms...`);
setTimeout(() => {
  connect().catch(e => {
    console.error("[Boot] Fatal:", e.message);
    // Retry after 30s on startup failure
    setTimeout(() => connect().catch(() => {}), 30000);
  });
}, startupDelay);
