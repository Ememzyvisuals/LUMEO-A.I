/**
 * lumeo_marketing.js — Marketing & Promotion Agent
 * EMEMZYVISUALS DIGITALS | Emmanuel.A
 *
 * Handles:
 * - Promoting services/projects to specific numbers
 * - Broadcasting to all known users
 * - Broadcasting to all groups
 * - Email outreach via nodemailer
 */
"use strict";

require("dotenv").config();
const { askGroq }      = require("./ai");
const { dbSaveCampaign } = require("./lumeo_db");

// ─── Generate promotional message with Groq ───────────────────────────────────
async function generatePromo(projectInfo, targetType = "general") {
  const systemPrompt = `You are a brilliant marketing copywriter for EMEMZYVISUALS DIGITALS.
Write a compelling WhatsApp promotional message about the project/service described.
Style: natural, engaging, Nigerian-aware but professional.
Include: what it is, why it's valuable, a clear call to action.
Keep it under 250 words. Use emojis strategically. End with contact info.
Contact: Ememzyvisuals@gmail.com | WhatsApp: +234 904 711 5612
DO NOT use markdown formatting that WhatsApp can't render (no #, no **).
Use *bold* for WhatsApp bold, _italic_ for italic.`;

  const prompt = `Write a promotional message for: ${projectInfo}\nTarget audience: ${targetType}`;
  const msg = await askGroq(systemPrompt, prompt, []);
  return msg || `🚀 *EMEMZYVISUALS DIGITALS*\n\n${projectInfo}\n\nContact: Ememzyvisuals@gmail.com`;
}

// ─── Parse promotion command ──────────────────────────────────────────────────
function parsePromoCommand(text) {
  // "promote [project] to [target]"
  // "send promo to [number/all users/all groups]"
  const t = text.toLowerCase();

  let target = "unknown";
  let project = text;

  if (/to all (users|contacts|everyone)/i.test(text)) target = "all_users";
  else if (/to all groups?/i.test(text))              target = "all_groups";
  else if (/to (everyone|all)/i.test(text))           target = "all";
  else {
    // Check for specific numbers
    const nums = text.match(/\+?[\d]{10,15}/g);
    if (nums) { target = nums.map(n => n.replace(/\D/g, "")); }
    else {
      const toMatch = text.match(/to\s+(.+)/i);
      if (toMatch) target = toMatch[1].trim();
    }
  }

  // Extract project info
  const projMatch = text.match(/promote\s+(.+?)\s+to/i) ||
                    text.match(/(?:advertise|market|send)\s+(.+?)\s+to/i);
  if (projMatch) project = projMatch[1].trim();
  else project = text.replace(/promote|advertise|market|send promo|send promotion/gi, "").replace(/to.*/i, "").trim();

  return { target, project: project || text };
}

// ─── Run promotion campaign ───────────────────────────────────────────────────
async function runPromotion(sock, params) {
  const { text, devJid, knownUsers = [], groupJids = [] } = params;
  const { target, project } = parsePromoCommand(text);

  console.log(`[Marketing] Campaign: target=${JSON.stringify(target)} project="${project.slice(0, 50)}"`);

  const promoMsg = await generatePromo(project, Array.isArray(target) ? "individual" : target);

  let targets    = [];
  let targetDesc = "";

  if (target === "all_users") {
    targets    = knownUsers.filter(p => p !== devJid?.split("@")[0]);
    targetDesc = `all ${targets.length} known users`;
  } else if (target === "all_groups") {
    targets    = groupJids;
    targetDesc = `all ${targets.length} groups`;
  } else if (target === "all") {
    targets    = [...knownUsers.filter(p => p !== devJid?.split("@")[0]).map(p => p + "@s.whatsapp.net"), ...groupJids];
    targetDesc = `${targets.length} users and groups`;
  } else if (Array.isArray(target)) {
    targets    = target.map(n => n + "@s.whatsapp.net");
    targetDesc = `${targets.length} specific numbers`;
  } else {
    // Specific name/number
    const num = target.replace(/\D/g, "");
    if (num.length >= 10) {
      targets    = [num + "@s.whatsapp.net"];
      targetDesc = num;
    } else {
      return { success: false, error: `Couldn't understand target: "${target}". Try "to all users", "to all groups", or "to +2348012345678"` };
    }
  }

  if (targets.length === 0) {
    return { success: false, error: "No targets found. Users need to message Lumeo first before they can receive promotions." };
  }

  // Send with delay to avoid spam detection
  let sent = 0, failed = 0;
  for (const jid of targets) {
    try {
      const id = jid.includes("@") ? jid : jid + "@s.whatsapp.net";
      await sock.sendMessage(id, { text: promoMsg });
      sent++;
      console.log(`[Marketing] ✅ Sent to ${id.split("@")[0]}`);
      // Delay: 3-5 seconds between messages
      await new Promise(r => setTimeout(r, 3000 + Math.random() * 2000));
    } catch (e) {
      failed++;
      console.log(`[Marketing] ❌ Failed ${jid}: ${e.message}`);
    }
  }

  // Save campaign record
  await dbSaveCampaign({
    project: project.slice(0, 200),
    target_type: Array.isArray(target) ? "specific" : target,
    sent, failed,
    created_at: new Date().toISOString(),
  }).catch(() => {});

  return {
    success: true,
    message: `✅ *Campaign Complete!*\n\n📨 Sent to: ${targetDesc}\n✅ Delivered: ${sent}\n❌ Failed: ${failed}\n\n*Preview:*\n${promoMsg.slice(0, 200)}...`,
  };
}

// ─── Email outreach ───────────────────────────────────────────────────────────
async function sendEmailOutreach(params) {
  const { to, subject, projectInfo, tone = "professional" } = params;
  const GMAIL_USER = process.env.EMAIL_USER || "";
  const GMAIL_PASS = process.env.EMAIL_PASS || "";

  if (!GMAIL_USER || !GMAIL_PASS) {
    return { success: false, error: "Email not configured. Add EMAIL_USER and EMAIL_PASS to Render environment." };
  }

  // Generate email content with Groq
  const sysP = `You are a professional business development email writer for EMEMZYVISUALS DIGITALS.
Write a compelling, ${tone} cold outreach email.
From: Emmanuel.A | CEO, EMEMZYVISUALS DIGITALS
Include: clear value proposition, relevant experience, specific call to action.
Keep it under 300 words. Professional but warm. End with full contact details.
Contact: Ememzyvisuals@gmail.com | +234 904 711 5612 | GitHub: @ememzyvisuals`;

  const emailBody = await askGroq(sysP, `Write an email about: ${projectInfo}\nTo: ${to}\nTone: ${tone}`, []);

  try {
    const nodemailer = require("nodemailer");
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: GMAIL_USER, pass: GMAIL_PASS },
    });

    await transporter.sendMail({
      from:    `"Emmanuel.A | EMEMZYVISUALS DIGITALS" <${GMAIL_USER}>`,
      to,
      subject: subject || `Partnership Opportunity — EMEMZYVISUALS DIGITALS`,
      text:    emailBody || projectInfo,
      html:    `<pre style="font-family:Arial;white-space:pre-wrap">${emailBody}</pre>`,
    });

    console.log(`[Email] ✅ Sent to ${to}`);
    return { success: true, message: `✅ Email sent to *${to}*\n\n*Preview:*\n${(emailBody || "").slice(0, 200)}...` };
  } catch (e) {
    console.error("[Email] Error:", e.message);
    return { success: false, error: `Email failed: ${e.message}` };
  }
}

module.exports = { runPromotion, sendEmailOutreach, parsePromoCommand, generatePromo };
