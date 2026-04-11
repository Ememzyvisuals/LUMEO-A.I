/**
 * lumeo_status.js — WhatsApp Status Manager
 * EMEMZYVISUALS DIGITALS | Emmanuel.A
 *
 * Post status updates, view/like/react to statuses
 * Note: Status posting to status@broadcast requires statusJidList (contacts to show it to)
 */
"use strict";

const { getStatusContent } = require("./personality");
const { askGroq }          = require("./ai");

let _sock = null;
let _statusJidCache = [];
let _statusCacheTime = 0;

const STATUS_COLORS = ["#1a1a2e", "#005c4b", "#128C7E", "#075E54", "#25D366", "#34B7F1", "#ECE5DD"];
const STATUS_FONTS  = [0, 1, 2, 3, 4, 5, 6];

function setStatusSock(sock) { _sock = sock; }

// ─── Get contacts list for status ────────────────────────────────────────────
async function getStatusContacts(targetGroupJid) {
  if (!_sock) return [];
  const now = Date.now();
  if (_statusJidCache.length > 0 && now - _statusCacheTime < 600000) return _statusJidCache;

  const jids = [];
  try {
    if (targetGroupJid) {
      const meta = await _sock.groupMetadata(targetGroupJid);
      (meta.participants || [])
        .map(p => p.id)
        .filter(id => id?.endsWith("@s.whatsapp.net"))
        .slice(0, 200)
        .forEach(id => jids.push(id));
    }
  } catch {}

  const unique = [...new Set(jids)];
  if (unique.length > 0) { _statusJidCache = unique; _statusCacheTime = now; }
  return unique;
}

// ─── Post a text status ───────────────────────────────────────────────────────
async function postStatus(text, targetGroupJid) {
  if (!_sock) return false;
  try {
    const jidList  = await getStatusContacts(targetGroupJid);
    const colorIdx = Math.floor(Math.random() * STATUS_COLORS.length);
    const fontIdx  = Math.floor(Math.random() * 3);

    await _sock.sendMessage(
      "status@broadcast",
      {
        text:            text.slice(0, 700),
        backgroundColor: STATUS_COLORS[colorIdx],
        font:            STATUS_FONTS[fontIdx],
      },
      {
        broadcast:     true,
        statusJidList: jidList.length > 0 ? jidList : undefined,
      }
    );
    console.log(`[Status] ✅ Posted: "${text.slice(0, 60)}"`);
    return true;
  } catch (e) {
    console.error("[Status] Post failed:", e.message);
    return false;
  }
}

// ─── React to a status ────────────────────────────────────────────────────────
async function reactToStatus(statusKey, emoji = "❤️") {
  if (!_sock || !statusKey) return false;
  try {
    await _sock.sendMessage("status@broadcast", {
      react: { text: emoji, key: statusKey },
    });
    console.log(`[Status] ✅ Reacted ${emoji} to status`);
    return true;
  } catch (e) {
    console.error("[Status] React failed:", e.message);
    return false;
  }
}

// ─── Generate AI status content ───────────────────────────────────────────────
async function generateStatusContent(topic = null) {
  if (topic) {
    const content = await askGroq(
      "You are a social media copywriter for EMEMZYVISUALS DIGITALS. Write a short, punchy WhatsApp status update (max 200 chars). No hashtags. Use 1-2 emojis max. Be authentic and engaging.",
      `Write a status about: ${topic}`,
      []
    );
    return content?.slice(0, 700) || getStatusContent();
  }
  return getStatusContent();
}

// ─── Handle incoming status messages ─────────────────────────────────────────
async function handleStatusMessage(msg, devJid) {
  if (!_sock || !msg) return;
  const { key, message, pushName } = msg;

  // Only process statuses from others (not our own)
  if (key.fromMe) return;
  const sender = key.participant || key.remoteJid;
  if (!sender) return;

  const text = message?.conversation || message?.extendedTextMessage?.text || "";
  console.log(`[Status] 👁️ Viewed status from ${pushName || sender.split("@")[0]}`);

  // Auto-react to status with ❤️ (warm engagement)
  try {
    await reactToStatus(key, "❤️");
  } catch {}

  // If status contains a question, answer it (only for dev's contacts)
  if (text.includes("?") && text.length > 5) {
    try {
      const reply = await askGroq(
        "You are Lumeo AI. Someone posted a WhatsApp status with a question. Reply briefly (1-2 sentences max) in a friendly, natural way.",
        `Status from ${pushName || "someone"}: "${text}"\nReply naturally:`,
        []
      );
      if (reply) {
        await _sock.sendMessage(sender, { text: reply });
        console.log(`[Status] ✅ Replied to ${pushName || sender.split("@")[0]}`);
      }
    } catch {}
  }
}

module.exports = { setStatusSock, postStatus, reactToStatus, generateStatusContent, handleStatusMessage, getStatusContacts };
