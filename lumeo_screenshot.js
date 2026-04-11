/**
 * lumeo_screenshot.js — Pixel-Accurate WhatsApp Screenshot
 * EMEMZYVISUALS DIGITALS | Emmanuel.A
 *
 * iPhone 14 dimensions: 390x844px
 * Exact WhatsApp 2025 colors verified from real screenshots
 * Pure SVG → sharp PNG (no browser needed)
 */
"use strict";

const fs   = require("fs");
const path = require("path");
const TMP  = "/tmp";

function e(s) {
  return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}

// Word wrap text to fit bubble width
function wrap(text, maxW, charW) {
  const maxChars = Math.floor(maxW / charW);
  const words    = String(text).split(" ");
  const lines    = [];
  let   cur      = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (test.length > maxChars && cur) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

async function generateWhatsAppScreenshot(messages, opts = {}) {
  const { style = "iphone", theme = "dark", contact = "Contact" } = opts;
  const dark = theme !== "light";

  // ── Exact WhatsApp colors (verified from real screenshots) ───────────────
  const C = dark ? {
    screenBg:  "#111b21",   // outer phone frame
    chatBg:    "#0b141a",   // chat area background
    header:    "#1f2c34",   // top bar
    incoming:  "#1f2c34",   // incoming bubble
    outgoing:  "#005c4b",   // outgoing bubble
    text:      "#e9edef",   // message text
    metaText:  "#8696a0",   // timestamp, status
    tick:      "#53bdeb",   // read tick blue
    unreadTick:"#a0b3be",   // unread tick grey
    input:     "#1f2c34",   // input bar background
    inputText: "#667781",   // "Type a message" placeholder
    datePill:  "#1f2c34",   // "Today" pill background
    datePillT: "#8696a0",   // date text
    divider:   "#262d31",   // separator lines
  } : {
    screenBg:  "#d1d7db",
    chatBg:    "#efeae2",
    header:    "#008069",
    incoming:  "#ffffff",
    outgoing:  "#d9fdd3",
    text:      "#111b21",
    metaText:  "#667781",
    tick:      "#53bdeb",
    unreadTick:"#667781",
    input:     "#ffffff",
    inputText: "#667781",
    datePill:  "rgba(255,255,255,0.88)",
    datePillT: "#54656f",
    divider:   "#e9edef",
  };

  const W   = 390;
  const R   = style === "iphone" ? 44 : 20;   // screen corner radius

  // Dimensions matching real WhatsApp
  const STATUS_H  = style === "iphone" ? 44 : 24;  // status bar
  const HEADER_H  = 60;                             // WhatsApp header bar
  const TOP       = STATUS_H + HEADER_H;
  const FOOTER_H  = 62;                             // input bar area
  const SAFE_B    = style === "iphone" ? 20 : 0;    // home indicator space

  // Bubble geometry
  const FONT   = 14.2;  // px — WhatsApp uses ~14px body
  const CHAR_W = 7.4;   // average char width at FONT
  const LINE_H = 20;
  const BPH    = 9;     // bubble horizontal padding
  const BPV    = 7;     // bubble vertical padding  
  const META_H = 16;    // time row height inside bubble
  const MARGIN = 9;     // bubble distance from screen edge
  const MAX_BW = 268;   // max bubble width
  const MIN_BW = 72;    // min bubble width
  const GAP    = 3;     // gap between bubbles
  const BR     = 8;     // bubble corner radius

  function bubbleSize(text) {
    const lines = wrap(text, MAX_BW - BPH * 2, CHAR_W);
    const bw    = Math.min(MAX_BW, Math.max(
      ...lines.map(l => Math.ceil(l.length * CHAR_W) + BPH * 2 + 2),
      MIN_BW
    ));
    return { bw, bh: lines.length * LINE_H + BPV * 2 + META_H, lines };
  }

  // Calculate total height
  let contentH = 36; // date pill area
  for (const m of messages) contentH += bubbleSize(m.text || "").bh + GAP;
  contentH += 10;

  const TOTAL = TOP + contentH + FOOTER_H + SAFE_B;

  // ── Build message bubbles SVG ─────────────────────────────────────────────
  let msgSvg = "";
  let y = TOP + 36;

  const now = new Date();
  for (const m of messages) {
    const isOut = m.from === "me";
    const bg    = isOut ? C.outgoing : C.incoming;
    const { bw, bh, lines } = bubbleSize(m.text || "");
    const bx    = isOut ? W - MARGIN - bw : MARGIN;
    const time  = m.time || `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;

    // Bubble rectangle with rounded corners
    // WhatsApp bubbles: fully rounded except the "tail" corner (bottom-right for out, bottom-left for in)
    const tailR = 2; // tail corner is nearly square
    const oBR   = BR; // other corners full radius

    let bPath;
    if (isOut) {
      // top-left, top-right, bottom-right(tail), bottom-left
      bPath = `M${bx+oBR},${y} L${bx+bw-oBR},${y} Q${bx+bw},${y} ${bx+bw},${y+oBR} L${bx+bw},${y+bh-tailR} Q${bx+bw},${y+bh} ${bx+bw-tailR},${y+bh} L${bx+oBR},${y+bh} Q${bx},${y+bh} ${bx},${y+bh-oBR} L${bx},${y+oBR} Q${bx},${y} ${bx+oBR},${y} Z`;
      // Tail pointing bottom-right
      msgSvg += `<path d="M${bx+bw},${y+bh-14} C${bx+bw+6},${y+bh-10} ${bx+bw+7},${y+bh} ${bx+bw+1},${y+bh} L${bx+bw-tailR},${y+bh} Q${bx+bw},${y+bh} ${bx+bw},${y+bh-tailR} Z" fill="${bg}"/>`;
    } else {
      // top-left(tail), top-right, bottom-right, bottom-left
      bPath = `M${bx+tailR},${y} L${bx+bw-oBR},${y} Q${bx+bw},${y} ${bx+bw},${y+oBR} L${bx+bw},${y+bh-oBR} Q${bx+bw},${y+bh} ${bx+bw-oBR},${y+bh} L${bx+tailR},${y+bh} Q${bx},${y+bh} ${bx},${y+bh-oBR} L${bx},${y+oBR} Q${bx},${y} ${bx+tailR},${y} Z`;
      // Tail pointing bottom-left
      msgSvg += `<path d="M${bx},${y+bh-14} C${bx-6},${y+bh-10} ${bx-7},${y+bh} ${bx-1},${y+bh} L${bx+tailR},${y+bh} Q${bx},${y+bh} ${bx},${y+bh-tailR} Z" fill="${bg}"/>`;
    }

    // Bubble fill
    msgSvg += `<path d="${bPath}" fill="${bg}"/>`;

    // Text lines
    for (let i = 0; i < lines.length; i++) {
      msgSvg += `<text x="${bx+BPH}" y="${y+BPV+FONT+i*LINE_H}" font-size="${FONT}" font-family="Helvetica Neue,Arial,sans-serif" fill="${C.text}">${e(lines[i])}</text>`;
    }

    // Timestamp (right-aligned inside bubble)
    const timeW = time.length * 6.5 + (isOut ? 20 : 4); // space for ticks
    msgSvg += `<text x="${bx+bw-BPH-timeW}" y="${y+bh-4}" font-size="11" font-family="Helvetica Neue,Arial,sans-serif" fill="${C.metaText}">${e(time)}</text>`;

    // Double ticks for outgoing
    if (isOut) {
      // Two check marks
      const tx = bx + bw - BPH - 2;
      const ty = y + bh - 4;
      msgSvg += `<text x="${tx}" y="${ty}" font-size="12" font-family="Helvetica Neue,Arial,sans-serif" fill="${C.tick}" text-anchor="end">✓✓</text>`;
    }

    y += bh + GAP;
  }

  // ── Contact avatar initials ───────────────────────────────────────────────
  const ini = e((contact||"?").slice(0,2).toUpperCase());

  // ── Clock ─────────────────────────────────────────────────────────────────
  const clock = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;

  // ── Full SVG ──────────────────────────────────────────────────────────────
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${TOTAL}">
<defs>
  <clipPath id="screen"><rect width="${W}" height="${TOTAL}" rx="${R}" ry="${R}"/></clipPath>
  <filter id="shadow" x="-5%" y="-5%" width="110%" height="110%">
    <feDropShadow dx="0" dy="1" stdDeviation="1" flood-color="rgba(0,0,0,0.2)"/>
  </filter>
</defs>
<g clip-path="url(#screen)">

<!-- Phone background -->
<rect width="${W}" height="${TOTAL}" fill="${C.screenBg}" rx="${R}" ry="${R}"/>

<!-- Status bar -->
<rect width="${W}" height="${STATUS_H}" fill="${C.header}"/>
${style==="iphone" ? `
<!-- iPhone notch -->
<rect x="${W/2-54}" y="0" width="108" height="28" rx="14" fill="#000"/>
<!-- Clock left -->
<text x="16" y="${STATUS_H-11}" font-size="15" font-weight="600" font-family="Helvetica Neue,Arial" fill="white">${clock}</text>
<!-- Right icons: signal + wifi + battery -->
<text x="${W-14}" y="${STATUS_H-10}" font-size="13" font-family="Helvetica Neue,Arial" fill="white" text-anchor="end">●●●● ▲</text>
` : `
<!-- Android status bar -->
<text x="14" y="${STATUS_H-6}" font-size="12" font-weight="600" font-family="Roboto,Arial" fill="white">${clock}</text>
<text x="${W-12}" y="${STATUS_H-6}" font-size="11" font-family="Roboto,Arial" fill="white" text-anchor="end">▲▲ ▣</text>
`}

<!-- Header bar -->
<rect y="${STATUS_H}" width="${W}" height="${HEADER_H}" fill="${C.header}"/>

<!-- Back arrow -->
<text x="8" y="${STATUS_H+38}" font-size="26" font-family="Helvetica Neue,Arial" fill="white" font-weight="300">&lt;</text>

<!-- Avatar circle -->
<circle cx="${STATUS_H===44 ? 56 : 52}" cy="${STATUS_H+30}" r="20" fill="#2c3e4a"/>
<text x="${STATUS_H===44 ? 56 : 52}" y="${STATUS_H+36}" font-size="13" font-weight="700" font-family="Helvetica Neue,Arial" fill="white" text-anchor="middle">${ini}</text>

<!-- Contact name + status -->
<text x="${STATUS_H===44 ? 85 : 81}" y="${STATUS_H+22}" font-size="16" font-weight="600" font-family="Helvetica Neue,Arial" fill="white">${e(contact)}</text>
<text x="${STATUS_H===44 ? 85 : 81}" y="${STATUS_H+40}" font-size="12" font-family="Helvetica Neue,Arial" fill="rgba(255,255,255,0.65)">online</text>

<!-- Header icons: video + call + menu -->
<text x="${W-95}" y="${STATUS_H+36}" font-size="22" font-family="Helvetica Neue,Arial" fill="white">&#9654;</text>
<text x="${W-60}" y="${STATUS_H+36}" font-size="22" font-family="Helvetica Neue,Arial" fill="white">&#9990;</text>
<text x="${W-25}" y="${STATUS_H+34}" font-size="22" font-family="Helvetica Neue,Arial" fill="white" text-anchor="middle">&#8942;</text>

<!-- Chat background (WhatsApp wallpaper-like) -->
<rect y="${TOP}" width="${W}" height="${contentH}" fill="${C.chatBg}"/>

<!-- "Today" date pill -->
<rect x="${W/2-24}" y="${TOP+9}" width="48" height="18" rx="9" fill="${C.datePill}"/>
<text x="${W/2}" y="${TOP+21}" font-size="11" font-family="Helvetica Neue,Arial" fill="${C.datePillT}" text-anchor="middle">Today</text>

<!-- Messages -->
${msgSvg}

<!-- Input bar -->
<rect y="${TOP+contentH}" width="${W}" height="${FOOTER_H}" fill="${C.header}"/>
<!-- Emoji icon left -->
<circle cx="28" cy="${TOP+contentH+31}" r="15" fill="none"/>
<text x="28" y="${TOP+contentH+37}" font-size="22" font-family="Helvetica Neue,Arial" text-anchor="middle" fill="${C.metaText}">&#9786;</text>
<!-- Input field -->
<rect x="52" y="${TOP+contentH+10}" width="${W-108}" height="42" rx="21" fill="${C.input}"/>
<text x="72" y="${TOP+contentH+35}" font-size="14" font-family="Helvetica Neue,Arial" fill="${C.inputText}">Type a message</text>
<!-- Mic button / send -->
<circle cx="${W-24}" cy="${TOP+contentH+31}" r="20" fill="#00a884"/>
<text x="${W-24}" y="${TOP+contentH+38}" font-size="19" font-family="Helvetica Neue,Arial" text-anchor="middle" fill="white">&#127908;</text>

<!-- Home indicator (iPhone) -->
${style==="iphone" ? `<rect x="${W/2-60}" y="${TOP+contentH+FOOTER_H+6}" width="120" height="4" rx="2" fill="rgba(255,255,255,0.3)"/>` : ""}

</g>
</svg>`;

  try {
    const sharp   = require("sharp");
    const ts      = Date.now();
    const outPath = path.join(TMP, `lumeo_ss_${ts}.png`);
    await sharp(Buffer.from(svg)).png({ quality: 95 }).toFile(outPath);
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 500) {
      const buf = fs.readFileSync(outPath);
      try { fs.unlinkSync(outPath); } catch {}
      console.log(`[Screenshot] ${(buf.length/1024).toFixed(0)}KB (${style} ${theme} ${messages.length} msgs)`);
      return { success: true, buffer: buf };
    }
  } catch (e) { console.error("[Screenshot]", e.message); }
  return { success: false };
}

function parseScreenshotRequest(text) {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const msgs  = [];
  let contact = "Friend";
  const base  = new Date();
  for (const line of lines) {
    const m = line.match(/^([^:\-]{1,28})[:\-]\s*(.+)$/);
    if (!m) continue;
    const sender = m[1].trim(), msg = m[2].trim();
    if (!msg) continue;
    const isMe = /^(me|my|myself|i)$/i.test(sender);
    if (!isMe && contact === "Friend") contact = sender;
    const t = new Date(base.getTime() + msgs.length * 75000);
    msgs.push({
      from: isMe ? "me" : sender, text: msg,
      time: `${String(t.getHours()).padStart(2,"0")}:${String(t.getMinutes()).padStart(2,"0")}`,
    });
  }
  return { messages: msgs, contact };
}

module.exports = { generateWhatsAppScreenshot, parseScreenshotRequest };
