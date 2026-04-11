/**
 * lumeo_status.js — WhatsApp Status Manager
 * EMEMZYVISUALS DIGITALS | Emmanuel.A
 *
 * Post text/image status, auto-view, auto-react, auto-reply to questions
 * Status posting requires statusJidList (contacts to show the status to)
 */
"use strict";

const { getStatusContent } = require("./personality");
const { askGroq }          = require("./ai");

let _sock           = null;
let _statusJidCache = [];
let _statusCacheTime = 0;

function setStatusSock(sock) { _sock = sock; }

const COLORS = ["#1a1a2e","#005c4b","#128C7E","#075E54","#1e3a5f","#2d4a22","#4a1942"];

// ─── Build contact list for status ──────────────────────────────────────────
// Tries group members first, then falls back to any known number
async function getStatusContacts(targetGroupJid) {
  if (!_sock) return [];
  const now = Date.now();
  if (_statusJidCache.length > 0 && now - _statusCacheTime < 300000) return _statusJidCache;

  const jids = new Set();

  // Method 1: From target group
  if (targetGroupJid) {
    try {
      const meta = await _sock.groupMetadata(targetGroupJid);
      (meta.participants || []).forEach(p => {
        if (p.id?.endsWith("@s.whatsapp.net")) jids.add(p.id);
      });
    } catch {}
  }

  // Method 2: From all groups bot is in
  if (jids.size < 5) {
    try {
      const groups = await _sock.groupFetchAllParticipating();
      for (const g of Object.values(groups || {})) {
        (g.participants || []).forEach(p => {
          if (p.id?.endsWith("@s.whatsapp.net") && jids.size < 300) jids.add(p.id);
        });
      }
    } catch {}
  }

  const list = [...jids];
  if (list.length > 0) { _statusJidCache = list; _statusCacheTime = now; }
  console.log(`[Status] Contact list: ${list.length} contacts`);
  return list;
}

// ─── Post text status ─────────────────────────────────────────────────────────
async function postStatus(text, targetGroupJid) {
  if (!_sock) return false;
  try {
    const jidList  = await getStatusContacts(targetGroupJid);
    const color    = COLORS[Math.floor(Math.random() * COLORS.length)];
    const font     = Math.floor(Math.random() * 4);  // 0-3

    const msgOpts = jidList.length > 0
      ? { broadcast: true, statusJidList: jidList }
      : { broadcast: true };

    await _sock.sendMessage(
      "status@broadcast",
      { text: text.slice(0, 700), backgroundColor: color, font },
      msgOpts
    );
    console.log(`[Status] Posted: "${text.slice(0, 60)}" to ${jidList.length} contacts`);
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
    await _sock.sendMessage("status@broadcast", { react: { text: emoji, key: statusKey } });
    return true;
  } catch (e) {
    console.error("[Status] React failed:", e.message);
    return false;
  }
}

// ─── Handle incoming status updates (view, react, reply) ─────────────────────
async function handleStatusMessage(msg) {
  if (!_sock || !msg || msg.key?.fromMe) return;
  const sender   = msg.key?.participant || msg.key?.remoteJid;
  const pushName = msg.pushName || "";
  if (!sender) return;

  const mc      = msg.message || {};
  const text    = mc.conversation || mc.extendedTextMessage?.text || "";
  const hasImg  = !!mc.imageMessage;

  console.log(`[Status] Viewed from ${pushName || sender.split("@")[0]}`);

  // Auto-react with heart
  try {
    await reactToStatus(msg.key, "❤️");
  } catch {}

  // If status has a question, reply to it
  if (text.includes("?") && text.length > 4) {
    try {
      const reply = await askGroq(
        "You are Lumeo, a friendly Nigerian AI. Someone posted a WhatsApp status with a question. Reply casually in 1-2 sentences max. Keep it light and natural.",
        `Status by ${pushName || "someone"}: "${text}"`,
        []
      );
      if (reply) {
        await _sock.sendMessage(sender, { text: reply.trim() });
      }
    } catch {}
  }
}

// ─── Generate AI status content ───────────────────────────────────────────────
async function generateStatusContent(topic) {
  if (topic && topic.length > 3) {
    const content = await askGroq(
      "Write a short, punchy WhatsApp status update (max 150 chars) for EMEMZYVISUALS DIGITALS. No hashtags. 1 emoji max. Engaging and authentic.",
      `Status about: ${topic}`,
      []
    );
    return (content || getStatusContent()).slice(0, 700);
  }
  return getStatusContent();
}

module.exports = { setStatusSock, postStatus, reactToStatus, generateStatusContent, handleStatusMessage, getStatusContacts };
