/**
 * lumeo_status.js — WhatsApp Status Manager
 * EMEMZYVISUALS DIGITALS | Emmanuel.A
 *
 * KEY INSIGHT (from Baileys docs):
 * statusJidList MUST be non-empty populated contacts array
 * backgroundColor and font go IN the message content, NOT in options
 * Correct format:
 *   sock.sendMessage('status@broadcast',
 *     { text, backgroundColor, font },
 *     { statusJidList: [...], broadcast: true }
 *   )
 *
 * Liking/reacting to statuses uses sock.readMessages on the status key
 * then sock.sendMessage with react on status@broadcast
 */
"use strict";

const { getStatusContent } = require("./personality");
const { askGroq }          = require("./ai");

let _sock          = null;
let _contactsCache = [];
let _cacheTime     = 0;

// Must be called right after sock connects
function setStatusSock(sock) { _sock = sock; }

// ─── Get WhatsApp contacts for statusJidList ───────────────────────────────
// Priority: sock.store contacts → group members → dev number fallback
async function getContactsForStatus() {
  if (!_sock) return [];
  const now = Date.now();
  if (_contactsCache.length > 0 && now - _cacheTime < 600000) {
    return _contactsCache;
  }

  const jids = new Set();

  // Method 1: sock.store if available (most reliable)
  try {
    if (_sock.store?.contacts) {
      const contacts = Object.keys(_sock.store.contacts);
      contacts.forEach(jid => {
        if (jid.endsWith("@s.whatsapp.net")) jids.add(jid);
      });
      console.log("[Status] Got " + jids.size + " contacts from store");
    }
  } catch {}

  // Method 2: All group participants (most available on Render)
  if (jids.size < 3) {
    try {
      const groups = await _sock.groupFetchAllParticipating();
      for (const g of Object.values(groups || {})) {
        (g.participants || []).forEach(p => {
          if (p.id?.endsWith("@s.whatsapp.net") && jids.size < 500) {
            jids.add(p.id);
          }
        });
      }
      console.log("[Status] Got " + jids.size + " contacts from groups");
    } catch (e) {
      console.log("[Status] Groups fetch error:", e.message);
    }
  }

  // Method 3: Target group specifically
  const TARGET = process.env.TARGET_GROUP_JID;
  if (TARGET && jids.size < 3) {
    try {
      const meta = await _sock.groupMetadata(TARGET);
      (meta.participants || []).forEach(p => {
        if (p.id?.endsWith("@s.whatsapp.net")) jids.add(p.id);
      });
      console.log("[Status] Got " + jids.size + " contacts from target group");
    } catch {}
  }

  // Fallback: at least include dev number so status shows on dev's phone
  const devNums = (process.env.ADMIN_NUMBERS || "").split(",").map(n => n.replace(/\D/g, "").trim()).filter(Boolean);
  devNums.forEach(n => {
    if (n.length >= 10) jids.add(n + "@s.whatsapp.net");
  });

  const list = [...jids];
  if (list.length > 0) {
    _contactsCache = list;
    _cacheTime     = now;
  }

  console.log("[Status] Final contact list size: " + list.length);
  return list;
}

// ─── Post text status ─────────────────────────────────────────────────────────
async function postStatus(text) {
  if (!_sock) { console.log("[Status] No socket"); return false; }

  const statusJidList = await getContactsForStatus();
  if (statusJidList.length === 0) {
    console.log("[Status] No contacts — cannot post status (WhatsApp requires non-empty statusJidList)");
    return false;
  }

  const colors = ["#1f2c34","#075E54","#128C7E","#25D366","#34B7F1","#0d1418","#1c2b33"];
  const color  = colors[Math.floor(Math.random() * colors.length)];
  const font   = Math.floor(Math.random() * 5);  // 0-4

  try {
    await _sock.sendMessage(
      "status@broadcast",
      {
        text:            String(text).slice(0, 700),
        backgroundColor: color,
        font:            font,
      },
      {
        broadcast:     true,
        statusJidList: statusJidList,
      }
    );
    console.log("[Status] Posted to " + statusJidList.length + " contacts: \"" + text.slice(0, 60) + "\"");
    return true;
  } catch (e) {
    console.error("[Status] Post failed:", e.message);
    return false;
  }
}

// ─── React/like a status ──────────────────────────────────────────────────────
// According to Baileys: react to a status by reacting on status@broadcast with the status key
async function reactToStatus(statusKey, emoji) {
  if (!_sock || !statusKey) return false;
  emoji = emoji || "❤️";
  try {
    await _sock.sendMessage("status@broadcast", {
      react: { text: emoji, key: statusKey },
    });
    console.log("[Status] Reacted " + emoji + " to status from " + (statusKey.participant || statusKey.remoteJid || "?").split("@")[0]);
    return true;
  } catch (e) {
    console.error("[Status] React failed:", e.message);
    return false;
  }
}

// ─── Handle incoming status update (view + react + optional reply) ────────────
async function handleStatusMessage(msg) {
  if (!_sock || !msg) return;
  if (msg.key?.fromMe) return;  // Skip our own statuses

  const sender   = msg.key?.participant || msg.key?.remoteJid || "";
  const pushName = msg.pushName || sender.split("@")[0];
  const mc       = msg.message || {};
  const text     = mc.conversation || mc.extendedTextMessage?.text || mc.imageMessage?.caption || "";

  if (!sender || !sender.includes("@")) return;

  console.log("[Status] Viewing status from " + pushName);

  // Auto read the status (marks it as seen)
  try {
    await _sock.readMessages([msg.key]);
  } catch {}

  // Auto-react with heart ❤️ (like their status)
  await reactToStatus(msg.key, "❤️");

  // If the status has a question, reply to their DM
  if (text && text.includes("?") && text.trim().length > 3) {
    try {
      const dmReply = await askGroq(
        "You are Lumeo AI. Someone posted a WhatsApp status with a question. Reply naturally in 1-2 sentences max, in English. Keep it light and friendly. No emojis overload.",
        "Status by " + pushName + ": \"" + text.trim().slice(0, 200) + "\"",
        []
      );
      if (dmReply) {
        await _sock.sendMessage(sender, { text: dmReply.trim() });
        console.log("[Status] Replied to " + pushName + "'s question");
      }
    } catch {}
  }
}

// ─── Generate AI status content ───────────────────────────────────────────────
async function generateStatusContent(topic) {
  if (topic && String(topic).trim().length > 3) {
    const content = await askGroq(
      "Write a short punchy WhatsApp status for EMEMZYVISUALS DIGITALS. Max 150 chars. English only. No hashtags. 1 emoji max. Authentic.",
      "Status about: " + topic,
      []
    );
    return (content || getStatusContent()).slice(0, 700);
  }
  return getStatusContent();
}


// ─── Post image to status ─────────────────────────────────────────────────────
async function postImageStatus(imageBuffer, caption) {
  if (!_sock) return false;
  const statusJidList = await getContactsForStatus();
  if (statusJidList.length === 0) {
    console.log("[Status] No contacts for image status");
    return false;
  }
  try {
    await _sock.sendMessage(
      "status@broadcast",
      {
        image:   imageBuffer,
        caption: caption || "",
        mimetype: "image/jpeg",
      },
      {
        broadcast:     true,
        statusJidList: statusJidList,
      }
    );
    console.log("[Status] Image posted to " + statusJidList.length + " contacts");
    return true;
  } catch (e) {
    console.error("[Status] Image post failed:", e.message);
    return false;
  }
}

// ─── Post video to status ─────────────────────────────────────────────────────
async function postVideoStatus(videoBuffer, caption) {
  if (!_sock) return false;
  const statusJidList = await getContactsForStatus();
  if (statusJidList.length === 0) return false;
  try {
    await _sock.sendMessage(
      "status@broadcast",
      {
        video:    videoBuffer,
        caption:  caption || "",
        mimetype: "video/mp4",
        gifPlayback: false,
      },
      {
        broadcast:     true,
        statusJidList: statusJidList,
      }
    );
    console.log("[Status] Video posted to " + statusJidList.length + " contacts");
    return true;
  } catch (e) {
    console.error("[Status] Video post failed:", e.message);
    return false;
  }
}

module.exports = { setStatusSock, postStatus, postImageStatus, postVideoStatus, reactToStatus, handleStatusMessage, generateStatusContent, getContactsForStatus };
