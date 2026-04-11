/**
 * lumeo_marketing.js — Marketing & Promotion Agent
 * EMEMZYVISUALS DIGITALS | Emmanuel.A
 */
"use strict";

require("dotenv").config();
const { askGroq }        = require("./ai");
const { dbSaveCampaign } = require("./lumeo_db");

// ─── Generate promo message ───────────────────────────────────────────────────
async function generatePromo(projectInfo, targetType = "general") {
  const msg = await askGroq(
    `You are a marketing copywriter for EMEMZYVISUALS DIGITALS.
Write a compelling WhatsApp promotional message. Style: natural, engaging, professional.
Include: what it is, why it's valuable, clear call to action.
Max 200 words. Use *bold* for WhatsApp. End with:
📧 Ememzyvisuals@gmail.com | 📞 +234 904 711 5612`,
    `Write a promo for: ${projectInfo}\nAudience: ${targetType}`,
    []
  );
  return msg || `🚀 *EMEMZYVISUALS DIGITALS*\n\n${projectInfo}\n\n📧 Ememzyvisuals@gmail.com`;
}

// ─── Parse promotion command (robust NLP) ────────────────────────────────────
function parsePromoCommand(text) {
  const t = text.trim();

  // Determine TARGET
  let target = "all_users"; // default when no clear target = all users

  if (/\ball\s+groups?\b/i.test(t))                                     target = "all_groups";
  else if (/\bto\s+all\s+(users?|contacts?|everyone|people)\b/i.test(t)) target = "all_users";
  else if (/\bto\s+(everyone|all)\b/i.test(t))                          target = "all";
  else if (/\ball\s+(users?|contacts?|everyone)\b/i.test(t))            target = "all_users";
  else if (/\bgroups?\b/i.test(t))                                      target = "all_groups";
  else {
    const nums = t.match(/(?:\+?234|0)[789]\d{9}/g);
    if (nums) target = nums.map(n => n.replace(/\D/g, "").replace(/^0/, "234"));
    else {
      const toMatch = t.match(/\bto\s+([+\d]{7,})/i);
      if (toMatch) {
        const num = toMatch[1].replace(/\D/g, "");
        if (num.length >= 10) target = [num.startsWith("0") ? "234" + num.slice(1) : num];
      }
    }
  }

  // Determine PROJECT description
  let project = "";
  const patterns = [
    /promote\s+(.+?)\s+to\s+/i,
    /advertise\s+(.+?)\s+to\s+/i,
    /market\s+(.+?)\s+to\s+/i,
    /send\s+(?:promo|promotion)\s+(?:about\s+)?(.+?)\s+to\s+/i,
    /promote\s+(.+)/i,
    /advertise\s+(.+)/i,
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (m) { project = m[1].trim(); break; }
  }
  if (!project) {
    project = t.replace(/\bpromote\b|\badvertise\b|\bmarket\b|\bsend\s+promo\b/gi, "")
               .replace(/\bto\s+(all\s+users?|all\s+groups?|everyone|all|\+?\d{7,})\b/gi, "")
               .replace(/\bto\b/gi, "")
               .replace(/\s+/g, " ").trim();
  }
  if (!project) project = "EMEMZYVISUALS DIGITALS services";

  return { target, project };
}

// ─── Run promotion campaign ───────────────────────────────────────────────────
async function runPromotion(sock, params) {
  const { text, devJid, knownUsers = [], groupJids = [] } = params;
  const { target, project } = parsePromoCommand(text);

  console.log(`[Marketing] Campaign: target=${JSON.stringify(target).slice(0,60)} project="${project.slice(0,50)}"`);

  const promoMsg = await generatePromo(project, Array.isArray(target) ? "specific contacts" : target);

  let targets = [], targetDesc = "";

  if (target === "all_users") {
    targets    = knownUsers.filter(p => p).map(p => p.includes("@") ? p : p + "@s.whatsapp.net");
    targetDesc = `${targets.length} known users`;
  } else if (target === "all_groups") {
    targets    = groupJids;
    targetDesc = `${targets.length} groups`;
  } else if (target === "all") {
    targets    = [
      ...knownUsers.filter(p => p).map(p => p.includes("@") ? p : p + "@s.whatsapp.net"),
      ...groupJids,
    ];
    targetDesc = `${targets.length} users + groups`;
  } else if (Array.isArray(target)) {
    targets    = target.map(n => n.includes("@") ? n : n + "@s.whatsapp.net");
    targetDesc = `${targets.length} specific number(s)`;
  }

  if (targets.length === 0) {
    return { success: false, error: "No targets found. Users need to message Lumeo first so they're in the system." };
  }

  let sent = 0, failed = 0;
  for (const jid of targets) {
    try {
      await sock.sendMessage(jid, { text: promoMsg });
      sent++;
      console.log(`[Marketing] ✅ Sent to ${jid.split("@")[0]}`);
      await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000));
    } catch (e) {
      failed++;
      console.log(`[Marketing] ❌ ${jid.split("@")[0]}: ${e.message}`);
    }
  }

  await dbSaveCampaign({ project: project.slice(0, 200), target_type: Array.isArray(target) ? "specific" : target, sent, failed, created_at: new Date().toISOString() }).catch(() => {});

  return {
    success: true,
    message: `✅ *Campaign Done!*\n\n📤 Target: ${targetDesc}\n✅ Sent: ${sent}\n❌ Failed: ${failed}\n\n*Sample message:*\n${promoMsg.slice(0, 150)}...`,
  };
}

// ─── Email outreach ───────────────────────────────────────────────────────────
async function sendEmailOutreach(params) {
  const { to, subject, projectInfo, tone = "professional" } = params;
  const USER = (process.env.EMAIL_USER || "").trim();
  const PASS = (process.env.EMAIL_PASS || "").trim();

  if (!USER || !PASS) return { success: false, error: "Add EMAIL_USER and EMAIL_PASS (Gmail app password) to Render environment variables." };
  if (!to || !to.includes("@")) return { success: false, error: `Invalid email address: "${to}"` };

  const emailBody = await askGroq(
    `You are writing a ${tone} business development email for EMEMZYVISUALS DIGITALS.
From: Emmanuel.A, CEO — Ememzyvisuals@gmail.com | +234 904 711 5612
Write a compelling cold outreach email. Max 250 words. Clear value proposition.`,
    `Email about: ${projectInfo}\nRecipient: ${to}`,
    []
  );

  try {
    const nodemailer = require("nodemailer");
    const transporter = nodemailer.createTransporter({
      host:   "smtp.gmail.com",
      port:   465,
      secure: true,
      auth:   { user: USER, pass: PASS },
      tls:    { rejectUnauthorized: false },
    });

    await transporter.verify();
    await transporter.sendMail({
      from:    `"Emmanuel.A | EMEMZYVISUALS DIGITALS" <${USER}>`,
      to,
      subject: subject || "Partnership Opportunity — EMEMZYVISUALS DIGITALS",
      text:    emailBody || projectInfo,
      html:    `<div style="font-family:Arial;font-size:15px;line-height:1.6">${(emailBody||"").replace(/\n/g,"<br>")}</div>`,
    });

    console.log(`[Email] ✅ Sent to ${to}`);
    return { success: true, message: `✅ Email sent to *${to}*\n\n_Preview:_\n${(emailBody||"").slice(0,200)}...` };
  } catch (e) {
    console.error("[Email] Error:", e.message);
    if (e.message.includes("Invalid login") || e.message.includes("Username and Password")) {
      return { success: false, error: "Gmail authentication failed. Make sure EMAIL_PASS is a Gmail App Password (not your regular password). Enable 2FA on Gmail first, then create an App Password at myaccount.google.com/apppasswords" };
    }
    return { success: false, error: `Email failed: ${e.message}` };
  }
}

module.exports = { runPromotion, sendEmailOutreach, parsePromoCommand, generatePromo };
