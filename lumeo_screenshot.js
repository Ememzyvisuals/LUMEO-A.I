/**
 * lumeo_screenshot.js — WhatsApp Chat Screenshot Generator
 * EMEMZYVISUALS DIGITALS | Emmanuel.A
 *
 * Renders a pixel-accurate Android WhatsApp screenshot using pure SVG → sharp
 * Based on real Android WhatsApp 2.25.x UI measurements
 */
"use strict";

const fs   = require("fs");
const path = require("path");
const TMP  = "/tmp";

function esc(s) {
  return String(s||"")
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;");
}

function wrapText(text, maxChars) {
  const words  = String(text).split(" ");
  const lines  = [];
  let   cur    = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (test.length > maxChars && cur) { lines.push(cur); cur = w; }
    else cur = test;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

async function generateWhatsAppScreenshot(messages, opts = {}) {
  const { theme = "dark", contact = "Contact" } = opts;
  // Android only now (most accurate)
  const dark = theme !== "light";

  // ── Real Android WhatsApp colors (from actual Android screenshots 2025) ──
  const C = dark ? {
    phoneBg:   "#1c1c1c",   // phone outer
    chatBg:    "#0b141a",   // main chat background (unique dark teal-black)
    header:    "#1f2c34",   // header bar
    incoming:  "#1f2c34",   // left bubble (incoming)
    outgoing:  "#005c4b",   // right bubble (outgoing) - WhatsApp signature green
    text:      "#e9edef",   // message text
    subText:   "#8696a0",   // timestamps, sub info
    tick:      "#53bdeb",   // blue double tick (read)
    greyTick:  "#8696a0",   // grey single tick (sent)
    input:     "#1f2c34",   // message input background
    inputPH:   "#8696a0",   // placeholder text
    dateBg:    "#1f2c34",   // "Today" badge bg
    dateText:  "#8696a0",   // "Today" text
  } : {
    phoneBg:   "#dce4e9",
    chatBg:    "#efeae2",   // WhatsApp light wallpaper
    header:    "#008069",   // WhatsApp green header
    incoming:  "#ffffff",   // white bubble
    outgoing:  "#d9fdd3",   // light green outgoing
    text:      "#111b21",
    subText:   "#667781",
    tick:      "#53bdeb",
    greyTick:  "#667781",
    input:     "#ffffff",
    inputPH:   "#8696a0",
    dateBg:    "rgba(255,255,255,0.9)",
    dateText:  "#54656f",
  };

  // Android dimensions (393x852 viewport, header=56, status=28)
  const W         = 393;
  const STATUS_H  = 28;
  const HEADER_H  = 56;
  const TOP       = STATUS_H + HEADER_H;
  const FOOTER_H  = 60;

  // Bubble geometry (matching real WA Android measurements)
  const FONT      = 14.5;
  const CHAR_W    = 7.5;
  const LINE_H    = 20;
  const BPH       = 10;   // bubble horizontal padding
  const BPV       = 7;    // bubble vertical padding
  const META_H    = 16;   // height of time row
  const EDGE_GAP  = 8;    // gap from screen edge
  const MAX_BW    = 270;  // max bubble width
  const MIN_BW    = 70;
  const BUBBLE_R  = 8;    // bubble corner radius (Android WA uses ~8px)
  const GAP       = 4;    // gap between messages

  function bubbleSize(text) {
    const mc    = Math.floor((MAX_BW - BPH * 2) / CHAR_W);
    const lines = wrapText(text, mc);
    const bw    = Math.min(MAX_BW, Math.max(
      ...lines.map(l => Math.ceil(l.length * CHAR_W + BPH * 2 + 4)),
      MIN_BW
    ));
    return { bw, bh: lines.length * LINE_H + BPV * 2 + META_H, lines };
  }

  // Total height
  let contentH = 32; // date badge
  for (const m of messages) contentH += bubbleSize(m.text||"").bh + GAP;
  contentH += 10;
  const TOTAL = TOP + contentH + FOOTER_H;

  const now   = new Date();
  const clock = `${String(now.getHours()).padStart(2,"0")}:${String(now.getMinutes()).padStart(2,"0")}`;
  const ini   = esc((contact||"?").slice(0,2).toUpperCase());

  // ── Build message bubbles ──────────────────────────────────────────────────
  let msgSvg = "";
  let y = TOP + 32;

  for (const m of messages) {
    const isOut = m.from === "me";
    const bg    = isOut ? C.outgoing : C.incoming;
    const { bw, bh, lines } = bubbleSize(m.text||"");
    const bx    = isOut ? W - EDGE_GAP - bw : EDGE_GAP;
    const time  = m.time || clock;
    const r     = BUBBLE_R;
    const tailR = 2; // tail corner nearly square

    // Android WhatsApp bubble shape:
    // Outgoing (right): all corners rounded except bottom-right (tail corner)
    // Incoming (left):  all corners rounded except bottom-left (tail corner)
    let bp;
    if (isOut) {
      bp = `M${bx+r},${y} H${bx+bw-r} Q${bx+bw},${y} ${bx+bw},${y+r} V${y+bh-tailR} Q${bx+bw},${y+bh} ${bx+bw-tailR},${y+bh} H${bx+r} Q${bx},${y+bh} ${bx},${y+bh-r} V${y+r} Q${bx},${y} ${bx+r},${y} Z`;
      // Tail: small polygon at bottom-right pointing right-down
      msgSvg += `<path d="M${bx+bw},${y+bh-12} L${bx+bw+6},${y+bh+1} L${bx+bw-tailR-1},${y+bh} Z" fill="${bg}"/>`;
    } else {
      bp = `M${bx+tailR},${y} H${bx+bw-r} Q${bx+bw},${y} ${bx+bw},${y+r} V${y+bh-r} Q${bx+bw},${y+bh} ${bx+bw-r},${y+bh} H${bx+r} Q${bx},${y+bh} ${bx},${y+bh-r} V${y+r} Q${bx},${y} ${bx+tailR},${y} Z`;
      // Tail: small polygon at bottom-left pointing left-down
      msgSvg += `<path d="M${bx},${y+bh-12} L${bx-6},${y+bh+1} L${bx+tailR+1},${y+bh} Z" fill="${bg}"/>`;
    }

    // Bubble body
    msgSvg += `<path d="${bp}" fill="${bg}"/>`;

    // Text lines
    for (let i = 0; i < lines.length; i++) {
      msgSvg += `<text x="${bx+BPH}" y="${y+BPV+FONT+i*LINE_H}" font-size="${FONT}" font-family="Roboto,Arial,sans-serif" fill="${C.text}">${esc(lines[i])}</text>`;
    }

    // Timestamp + ticks
    const tw     = time.length * 6.2;
    const tickW  = isOut ? 18 : 0;
    const metaX  = bx + bw - BPH - tw - tickW;

    msgSvg += `<text x="${metaX}" y="${y+bh-4}" font-size="11" font-family="Roboto,Arial,sans-serif" fill="${C.subText}">${esc(time)}</text>`;

    if (isOut) {
      // Double tick ✓✓ in WhatsApp blue
      msgSvg += `<text x="${bx+bw-BPH-2}" y="${y+bh-4}" font-size="12" font-family="Roboto,Arial,sans-serif" fill="${C.tick}" text-anchor="end">✓✓</text>`;
    }

    y += bh + GAP;
  }

  // ── Full SVG ───────────────────────────────────────────────────────────────
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${TOTAL}">
<defs>
  <clipPath id="ph"><rect width="${W}" height="${TOTAL}" rx="12" ry="12"/></clipPath>
</defs>
<g clip-path="url(#ph)">

<!-- Phone body -->
<rect width="${W}" height="${TOTAL}" fill="${C.phoneBg}"/>

<!-- Android status bar (28px) -->
<rect width="${W}" height="${STATUS_H}" fill="${C.header}"/>
<text x="12" y="20" font-size="12" font-weight="600" font-family="Roboto,Arial" fill="white">${clock}</text>
<!-- Status icons right side -->
<text x="${W-12}" y="20" font-size="11" font-family="Roboto,Arial" fill="white" text-anchor="end">● ▲ ▣</text>

<!-- Header bar (56px) -->
<rect y="${STATUS_H}" width="${W}" height="${HEADER_H}" fill="${C.header}"/>
<!-- Back arrow -->
<text x="10" y="${STATUS_H+36}" font-size="22" font-family="Roboto,Arial" fill="white" font-weight="300">&lt;</text>
<!-- Avatar -->
<circle cx="48" cy="${STATUS_H+28}" r="19" fill="#2c4a52"/>
<text x="48" y="${STATUS_H+34}" font-size="13" font-weight="700" font-family="Roboto,Arial" fill="white" text-anchor="middle">${ini}</text>
<!-- Contact name -->
<text x="77" y="${STATUS_H+22}" font-size="17" font-weight="600" font-family="Roboto,Arial" fill="white">${esc(contact)}</text>
<text x="77" y="${STATUS_H+40}" font-size="12" font-family="Roboto,Arial" fill="rgba(255,255,255,0.72)">online</text>
<!-- Header icons: video, call, more -->
<text x="${W-90}" y="${STATUS_H+34}" font-size="20" font-family="Roboto,Arial" fill="white">&#9654;</text>
<text x="${W-55}" y="${STATUS_H+34}" font-size="20" font-family="Roboto,Arial" fill="white">&#9990;</text>
<text x="${W-20}" y="${STATUS_H+34}" font-size="22" font-family="Roboto,Arial" fill="white" text-anchor="middle">&#8942;</text>

<!-- Chat background -->
<rect y="${TOP}" width="${W}" height="${contentH}" fill="${C.chatBg}"/>

<!-- Date badge "Today" -->
<rect x="${W/2-25}" y="${TOP+8}" width="50" height="18" rx="9" fill="${C.dateBg}"/>
<text x="${W/2}" y="${TOP+20}" font-size="11.5" font-family="Roboto,Arial" fill="${C.dateText}" text-anchor="middle">Today</text>

<!-- Messages -->
${msgSvg}

<!-- Input bar -->
<rect y="${TOP+contentH}" width="${W}" height="${FOOTER_H}" fill="${C.header}"/>
<!-- Emoji icon -->
<circle cx="28" cy="${TOP+contentH+30}" r="13" fill="none"/>
<text x="28" y="${TOP+contentH+36}" font-size="20" font-family="Roboto,Arial" text-anchor="middle" fill="${C.inputPH}">&#128512;</text>
<!-- Input field (rounded) -->
<rect x="50" y="${TOP+contentH+10}" width="${W-106}" height="40" rx="20" fill="${C.input}"/>
<text x="70" y="${TOP+contentH+33}" font-size="14" font-family="Roboto,Arial" fill="${C.inputPH}">Type a message</text>
<!-- Mic / Send button (FAB) -->
<circle cx="${W-22}" cy="${TOP+contentH+30}" r="19" fill="#00a884"/>
<text x="${W-22}" y="${TOP+contentH+37}" font-size="18" font-family="Roboto,Arial" text-anchor="middle" fill="white">&#127908;</text>

</g>
</svg>`;

  try {
    const sharp   = require("sharp");
    const ts      = Date.now();
    const outPath = path.join(TMP, `lumeo_ss_${ts}.png`);
    await sharp(Buffer.from(svg)).png({ quality: 95 }).toFile(outPath);
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 200) {
      const buf = fs.readFileSync(outPath);
      try { fs.unlinkSync(outPath); } catch {}
      console.log(`[Screenshot] ${(buf.length/1024).toFixed(0)}KB (android ${theme})`);
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
