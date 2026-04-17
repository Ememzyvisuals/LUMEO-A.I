/**
 * lumeo_status.js — WhatsApp Status Manager
 * EMEMZYVISUALS DIGITALS | Emmanuel.A
 *
 * Supports:
 * - Text status (with color/font)
 * - Image status  
 * - Video status
 * - Audio status (voice note)
 *
 * KEY: statusJidList MUST be populated from real contacts
 * We pre-populate on connect and cache for 10 minutes
 */
"use strict";

const { getStatusContent } = require("./personality");
const { askGroq }          = require("./ai");

let _sock          = null;
let _contactsCache = [];
let _cacheTime     = 0;

function setStatusSock(sock) {
  _sock = sock;
  // Pre-warm the contacts cache on connect
  setTimeout(() => getContactsForStatus().catch(() => {}), 5000);
}

// ─── Get contacts list ────────────────────────────────────────────────────────
async function getContactsForStatus() {
  if (!_sock) return [];
  const now = Date.now();

  // Use cache if fresh (10 min)
  if (_contactsCache.length > 0 && now - _cacheTime < 600000) {
    return _contactsCache;
  }

  const jids = new Set();

  // Always include dev numbers
  (process.env.ADMIN_NUMBERS || "").split(",").forEach(n => {
    const num = n.replace(/\D/g, "").trim();
    if (num.length >= 10) jids.add(num + "@s.whatsapp.net");
  });

  // Fetch from all groups the bot is in
  try {
    const groups = await _sock.groupFetchAllParticipating();
    for (const g of Object.values(groups || {})) {
      for (const p of (g.participants || [])) {
        if (p.id?.endsWith("@s.whatsapp.net") && jids.size < 500) {
          jids.add(p.id);
        }
      }
    }
    console.log("[Status] Contacts from groups:", jids.size);
  } catch (e) {
    console.log("[Status] Group fetch error:", e.message);
  }

  // Specific target group
  const TARGET = process.env.TARGET_GROUP_JID;
  if (TARGET && jids.size < 3) {
    try {
      const meta = await _sock.groupMetadata(TARGET);
      (meta.participants || []).forEach(p => {
        if (p.id?.endsWith("@s.whatsapp.net")) jids.add(p.id);
      });
    } catch {}
  }

  const list = [...jids];
  if (list.length > 0) { _contactsCache = list; _cacheTime = now; }
  console.log("[Status] Final contacts:", list.length);
  return list;
}

// ─── Colors and fonts ─────────────────────────────────────────────────────────
const COLORS = [
  "#075E54", "#1a237e", "#880e4f", "#1b5e20",
  "#0d47a1", "#4a148c", "#bf360c", "#006064",
  "#37474f", "#1c2b33", "#e65100", "#283593",
];
function randColor() { return COLORS[Math.floor(Math.random() * COLORS.length)]; }
function randFont()  { return Math.floor(Math.random() * 7); }

// ─── Post TEXT status ─────────────────────────────────────────────────────────
async function postStatus(text) {
  if (!_sock) return false;
  const jidList = await getContactsForStatus();
  if (jidList.length === 0) {
    console.log("[Status] FAILED: no contacts. statusJidList is required.");
    return false;
  }
  try {
    await _sock.sendMessage(
      "status@broadcast",
      { text: String(text).slice(0, 700), backgroundColor: randColor(), font: randFont() },
      { broadcast: true, statusJidList: jidList }
    );
    console.log("[Status] TEXT posted (" + jidList.length + " contacts): " + text.slice(0, 60));
    return true;
  } catch (e) { console.error("[Status] Text post failed:", e.message); return false; }
}

// ─── Post IMAGE status ────────────────────────────────────────────────────────
async function postImageStatus(imageBuffer, caption) {
  if (!_sock) return false;
  const jidList = await getContactsForStatus();
  if (jidList.length === 0) { console.log("[Status] No contacts for image status"); return false; }
  try {
    await _sock.sendMessage(
      "status@broadcast",
      { image: imageBuffer, caption: caption || "", mimetype: "image/jpeg" },
      { broadcast: true, statusJidList: jidList }
    );
    console.log("[Status] IMAGE posted (" + jidList.length + " contacts)");
    return true;
  } catch (e) { console.error("[Status] Image post failed:", e.message); return false; }
}

// ─── Post VIDEO status ────────────────────────────────────────────────────────
async function postVideoStatus(videoBuffer, caption) {
  if (!_sock) return false;
  const jidList = await getContactsForStatus();
  if (jidList.length === 0) { console.log("[Status] No contacts for video status"); return false; }
  try {
    await _sock.sendMessage(
      "status@broadcast",
      { video: videoBuffer, caption: caption || "", mimetype: "video/mp4" },
      { broadcast: true, statusJidList: jidList }
    );
    console.log("[Status] VIDEO posted (" + jidList.length + " contacts)");
    return true;
  } catch (e) { console.error("[Status] Video post failed:", e.message); return false; }
}

// ─── Post AUDIO/VOICE status ──────────────────────────────────────────────────
async function postAudioStatus(audioBuffer, mimeType) {
  if (!_sock) return false;
  const jidList = await getContactsForStatus();
  if (jidList.length === 0) { console.log("[Status] No contacts for audio status"); return false; }
  try {
    await _sock.sendMessage(
      "status@broadcast",
      {
        audio:    audioBuffer,
        mimetype: mimeType || "audio/ogg; codecs=opus",
        ptt:      true,       // voice note style
      },
      { broadcast: true, statusJidList: jidList }
    );
    console.log("[Status] AUDIO posted (" + jidList.length + " contacts)");
    return true;
  } catch (e) { console.error("[Status] Audio post failed:", e.message); return false; }
}

// ─── React/like a status ──────────────────────────────────────────────────────
async function reactToStatus(statusKey, emoji) {
  if (!_sock || !statusKey) return false;
  emoji = emoji || "❤️";
  try {
    // Read it first
    await _sock.readMessages([statusKey]).catch(() => {});
    // Then react
    await _sock.sendMessage("status@broadcast", {
      react: { text: emoji, key: statusKey },
    });
    console.log("[Status] Reacted " + emoji);
    return true;
  } catch (e) { console.error("[Status] React failed:", e.message); return false; }
}

// ─── Handle incoming status ───────────────────────────────────────────────────
async function handleStatusMessage(msg) {
  if (!_sock || !msg || msg.key?.fromMe) return;
  const sender   = msg.key?.participant || msg.key?.remoteJid || "";
  const pushName = msg.pushName || sender.split("@")[0];
  if (!sender || !sender.includes("@")) return;
  const mc   = msg.message || {};
  const text = mc.conversation || mc.extendedTextMessage?.text || mc.imageMessage?.caption || "";
  console.log("[Status] Viewing status from " + pushName);
  // Mark as read + react
  try { await _sock.readMessages([msg.key]); } catch {}
  await reactToStatus(msg.key, "❤️");
  // Reply to questions
  if (text && text.includes("?") && text.trim().length > 3) {
    try {
      const reply = await askGroq(
        "You are Lumeo AI. Someone posted a WhatsApp status with a question. Reply naturally in 1-2 sentences in English.",
        "Status by " + pushName + ": \"" + text.trim().slice(0, 200) + "\"",
        []
      );
      if (reply) await _sock.sendMessage(sender, { text: reply.trim() });
    } catch {}
  }
}

// ─── Generate AI status content ───────────────────────────────────────────────
async function generateStatusContent(topic) {
  if (topic && String(topic).trim().length > 3) {
    const c = await askGroq(
      "Write a short punchy WhatsApp status for EMEMZYVISUALS DIGITALS. Max 150 chars. English only. Engaging and professional.",
      "Status about: " + topic, []
    );
    return (c || getStatusContent()).slice(0, 700);
  }
  return getStatusContent();
}

module.exports = {
  setStatusSock, getContactsForStatus,
  postStatus, postImageStatus, postVideoStatus, postAudioStatus,
  reactToStatus, handleStatusMessage, generateStatusContent,
};
