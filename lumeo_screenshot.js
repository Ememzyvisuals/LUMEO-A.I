/**
 * lumeo_screenshot.js — WhatsApp Screenshot Generator
 * EMEMZYVISUALS DIGITALS | Emmanuel.A
 * Pixel-accurate WhatsApp 2025 UI using SVG → sharp → PNG
 */
"use strict";

const fs   = require("fs");
const path = require("path");
const TMP  = "/tmp";

function esc(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function wrapText(text, maxChars) {
  const words = String(text).split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    if ((cur + " " + w).trim().length > maxChars && cur) { lines.push(cur.trim()); cur = w; }
    else cur = cur ? cur + " " + w : w;
  }
  if (cur.trim()) lines.push(cur.trim());
  return lines.length ? lines : [""];
}

async function generateWhatsAppScreenshot(messages, opts = {}) {
  const { style = "iphone", theme = "light", contact = "Contact" } = opts;
  const dark = theme === "dark";

  const C = dark ? {
    bg: "#0b141a", header: "#1f2c34", incoming: "#1f2c34", outgoing: "#005c4b",
    text: "#e9edef", meta: "#8696a0", tick: "#53bdeb", input: "#1f2c34",
    dateBg: "rgba(11,20,26,0.9)",
  } : {
    bg: "#efeae2", header: "#008069", incoming: "#ffffff", outgoing: "#d9fdd3",
    text: "#111b21", meta: "#667781", tick: "#53bdeb", input: "#ffffff",
    dateBg: "rgba(255,255,255,0.9)",
  };

  const W = 390, CHAR_W = 7.6, LINE_H = 20, FS = 14.5;
  const MAX_BW = 272, BPH = 10, BPV = 7, META_H = 18, GAP = 3;
  const STATUS_H = style === "iphone" ? 50 : 24;
  const HEADER_H = 56, FOOTER_H = 58, DATE_H = 30;
  const TOP_H    = STATUS_H + HEADER_H;

  function bubbleSize(text) {
    const mc    = Math.floor((MAX_BW - BPH * 2) / CHAR_W);
    const lines = wrapText(text, mc);
    const bw    = Math.min(MAX_BW, Math.max(...lines.map(l => l.length * CHAR_W + BPH * 2 + 10), 80));
    return { bw, bh: lines.length * LINE_H + BPV * 2 + META_H, lines };
  }

  let contentH = DATE_H + 8;
  messages.forEach(m => { contentH += bubbleSize(m.text || "").bh + GAP; });
  contentH += 12;
  const TOTAL_H = TOP_H + contentH + FOOTER_H;

  let msgSvg = "";
  let y = TOP_H + DATE_H + 8;

  for (const m of messages) {
    const isOut = m.from === "me";
    const { bw, bh, lines } = bubbleSize(m.text || "");
    const bx   = isOut ? W - 10 - bw : 10;
    const bg   = isOut ? C.outgoing : C.incoming;
    const time = m.time || "10:00";
    const r = 10;

    // Bubble with tail
    const tailOut = `M${bx + bw},${y + bh - 12} C${bx + bw + 6},${y + bh - 8} ${bx + bw + 6},${y + bh} ${bx + bw},${y + bh}`;
    const tailIn  = `M${bx},${y + bh - 12} C${bx - 6},${y + bh - 8} ${bx - 6},${y + bh} ${bx},${y + bh}`;
    const rect    = `M${bx + r},${y} L${bx + bw - r},${y} Q${bx + bw},${y} ${bx + bw},${y + r} L${bx + bw},${y + bh - r} Q${bx + bw},${y + bh} ${bx + bw - r},${y + bh} L${bx + r},${y + bh} Q${bx},${y + bh} ${bx},${y + bh - r} L${bx},${y + r} Q${bx},${y} ${bx + r},${y} Z`;

    let textSvg = "";
    lines.forEach((l, i) => {
      textSvg += `<text x="${bx + BPH}" y="${y + BPV + FS + i * LINE_H}" font-family="-apple-system,Helvetica Neue,Arial,sans-serif" font-size="${FS}" fill="${C.text}">${esc(l)}</text>`;
    });

    const tickSvg = isOut ? `<text x="${bx + bw - BPH - 1}" y="${y + bh - 5}" font-size="11" fill="${C.tick}" text-anchor="end" font-family="-apple-system,Helvetica Neue,Arial">✓✓</text>` : "";
    const timeX   = bx + bw - BPH - (isOut ? 42 : 32);

    msgSvg += `
    <path d="${rect} ${isOut ? tailOut : tailIn}" fill="${bg}"/>
    ${textSvg}
    <text x="${timeX}" y="${y + bh - 5}" font-size="11" fill="${C.meta}" font-family="-apple-system,Helvetica Neue,Arial">${esc(time)}</text>
    ${tickSvg}`;
    y += bh + GAP;
  }

  const clock = new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false });
  const ini   = esc((contact || "?").slice(0, 2).toUpperCase());
  const notch = style === "iphone" ? `<rect x="${W / 2 - 55}" y="0" width="110" height="34" rx="17" fill="#000"/>` : "";
  const statusSvg = style === "iphone"
    ? `${notch}<text x="20" y="37" font-family="-apple-system,Helvetica Neue,Arial" font-weight="600" font-size="15" fill="white">${clock}</text><text x="${W - 20}" y="37" font-family="-apple-system,Helvetica Neue,Arial" font-size="12" fill="white" text-anchor="end">●●●● WiFi 🔋</text>`
    : `<text x="14" y="18" font-family="Roboto,Arial,sans-serif" font-weight="600" font-size="12" fill="white">${clock}</text><text x="${W - 12}" y="18" font-family="Roboto,Arial,sans-serif" font-size="11" fill="white" text-anchor="end">📶 WiFi 🔋</text>`;

  const avY = STATUS_H + 28;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${TOTAL_H}">
  <defs><clipPath id="ph"><rect width="${W}" height="${TOTAL_H}" rx="${style === "iphone" ? 44 : 0}"/></clipPath></defs>
  <g clip-path="url(#ph)">
  <rect width="${W}" height="${TOTAL_H}" fill="${C.bg}"/>
  <rect width="${W}" height="${STATUS_H}" fill="${C.header}"/>
  ${statusSvg}
  <rect y="${STATUS_H}" width="${W}" height="${HEADER_H}" fill="${C.header}"/>
  <text x="12" y="${STATUS_H + 37}" font-family="-apple-system,Helvetica Neue,Arial" font-size="26" fill="white" font-weight="300">‹</text>
  <circle cx="54" cy="${avY}" r="19" fill="#3c5a6e"/>
  <text x="54" y="${avY + 6}" font-family="-apple-system,Helvetica Neue,Arial" font-size="13" font-weight="600" fill="white" text-anchor="middle">${ini}</text>
  <text x="83" y="${STATUS_H + 24}" font-family="-apple-system,Helvetica Neue,Arial" font-size="16" font-weight="600" fill="white">${esc(contact)}</text>
  <text x="83" y="${STATUS_H + 41}" font-family="-apple-system,Helvetica Neue,Arial" font-size="12" fill="rgba(255,255,255,0.72)">online</text>
  <text x="${W - 90}" y="${STATUS_H + 34}" font-family="-apple-system,Helvetica Neue,Arial" font-size="20" fill="white">📹</text>
  <text x="${W - 55}" y="${STATUS_H + 34}" font-family="-apple-system,Helvetica Neue,Arial" font-size="20" fill="white">📞</text>
  <text x="${W - 24}" y="${STATUS_H + 34}" font-family="-apple-system,Helvetica Neue,Arial" font-size="20" fill="white" text-anchor="middle">⋮</text>
  <rect x="${W / 2 - 26}" y="${TOP_H + 6}" width="52" height="18" rx="9" fill="${C.dateBg}"/>
  <text x="${W / 2}" y="${TOP_H + 18}" font-family="-apple-system,Helvetica Neue,Arial" font-size="11" fill="${C.meta}" text-anchor="middle">Today</text>
  ${msgSvg}
  <rect y="${TOTAL_H - FOOTER_H}" width="${W}" height="${FOOTER_H}" fill="${C.header}"/>
  <text x="14" y="${TOTAL_H - FOOTER_H + 35}" font-family="-apple-system,Helvetica Neue,Arial" font-size="22" fill="rgba(255,255,255,0.7)">😊</text>
  <rect x="44" y="${TOTAL_H - FOOTER_H + 10}" width="${W - 100}" height="36" rx="18" fill="${C.input}"/>
  <text x="60" y="${TOTAL_H - FOOTER_H + 32}" font-family="-apple-system,Helvetica Neue,Arial" font-size="14" fill="${C.meta}">Message</text>
  <circle cx="${W - 22}" cy="${TOTAL_H - FOOTER_H + 28}" r="17" fill="#00a884"/>
  <text x="${W - 22}" y="${TOTAL_H - FOOTER_H + 34}" font-family="-apple-system,Helvetica Neue,Arial" font-size="17" text-anchor="middle" fill="white">🎤</text>
  ${style === "iphone" ? `<rect x="${W / 2 - 60}" y="${TOTAL_H - 8}" width="120" height="4" rx="2" fill="rgba(255,255,255,0.35)"/>` : ""}
  </g>
</svg>`;

  try {
    const sharp   = require("sharp");
    const ts      = Date.now();
    const outPath = path.join(TMP, `lumeo_ss_${ts}.png`);
    await sharp(Buffer.from(svg)).png().toFile(outPath);
    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 500) {
      const buf = fs.readFileSync(outPath);
      try { fs.unlinkSync(outPath); } catch {}
      console.log(`[Screenshot] ✅ ${(buf.length / 1024).toFixed(0)}KB (${style} ${theme})`);
      return { success: true, buffer: buf };
    }
  } catch (e) { console.error("[Screenshot]", e.message); }
  return { success: false };
}

function parseScreenshotRequest(text) {
  const lines   = text.split("\n").map(l => l.trim()).filter(Boolean);
  const msgs    = [];
  let contact   = "Friend";
  const base    = new Date();
  for (const line of lines) {
    const m = line.match(/^([^:\-]{1,24})[:\-]\s*(.+)$/);
    if (!m) continue;
    const sender = m[1].trim(), msg = m[2].trim();
    if (!msg) continue;
    const isMe = /^(me|my|myself|i)$/i.test(sender);
    if (!isMe && contact === "Friend") contact = sender;
    const t = new Date(base.getTime() + msgs.length * 75000);
    msgs.push({ from: isMe ? "me" : sender, text: msg, time: `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}` });
  }
  return { messages: msgs, contact };
}

module.exports = { generateWhatsAppScreenshot, parseScreenshotRequest };
