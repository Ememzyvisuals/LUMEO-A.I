/**
 * lumeo_interactive.js — Interactive UI via WhatsApp Polls
 * EMEMZYVISUALS DIGITALS | Emmanuel.A
 *
 * WhatsApp native buttons were permanently patched out by Meta.
 * Polls are the only fully reliable native interactive element in Baileys.
 *
 * How it works:
 * 1. Lumeo sends a poll with tappable options after greetings / key moments
 * 2. User taps an option → WhatsApp sends a pollUpdate event
 * 3. Lumeo treats the tapped option as a message and responds
 *
 * Also handles "real-life problem solvers":
 * - Budget/expense calculator
 * - Job application drafter
 * - Homework/study helper
 * - Business name/idea generator
 * - CV builder
 * - Relationship/personal advice
 */
"use strict";

const { askGroq } = require("./ai");

// ─── Send an interactive poll ─────────────────────────────────────────────────
// Max 12 options, max 20 chars per option
async function sendPoll(sock, jid, question, options, allowMultiple = false) {
  try {
    await sock.sendMessage(jid, {
      poll: {
        name:            question.slice(0, 255),
        values:          options.slice(0, 12).map(o => String(o).slice(0, 20)),
        selectableCount: allowMultiple ? options.length : 1,
      },
    });
    return true;
  } catch (e) {
    console.error("[Poll] Failed:", e.message);
    return false;
  }
}

// ─── Welcome menu — sent when user opens chat for the first time ──────────────
async function sendWelcomeMenu(sock, jid, name) {
  const greeting = name ? `Hey ${name}! 👋 I'm Lumeo` : "Hey! 👋 I'm Lumeo";
  await sock.sendMessage(jid, {
    text: greeting + ", your AI assistant by *EMEMZYVISUALS DIGITALS*.\n\nI can help you with a lot — tap what you need right now 👇",
  });
  await new Promise(r => setTimeout(r, 800));
  await sendPoll(sock, jid, "What do you need?", [
    "🎵 Download music",
    "📹 Download video",
    "💬 Just chat with me",
    "🎨 Generate an image",
    "📄 Create a PDF",
    "💡 Solve a problem",
    "📸 WhatsApp screenshot",
    "📊 Budget calculator",
    "💼 Write my CV",
    "🔥 Post a status",
  ]);
}

// ─── Post-reply suggestion poll (keep conversation going) ────────────────────
// Sent after Lumeo answers — gives contextual next steps
async function sendSuggestions(sock, jid, context) {
  const ctx = (context || "").toLowerCase();

  let question = "What would you like next?";
  let options;

  if (/music|song|audio|download/i.test(ctx)) {
    options = ["Play another song", "Download a video", "Post to status", "More Afrobeats", "Back to menu"];
  } else if (/image|generate|art|design/i.test(ctx)) {
    options = ["Generate another", "Make it a sticker", "Post to status", "Make a PDF", "Back to menu"];
  } else if (/pdf|document|cv|certificate/i.test(ctx)) {
    options = ["Download it", "Edit the content", "Send via email", "Generate image", "Back to menu"];
  } else if (/code|bug|error|program/i.test(ctx)) {
    options = ["Explain more", "Show full code", "Debug this", "Next feature", "Back to menu"];
  } else if (/budget|expense|money|naira/i.test(ctx)) {
    options = ["Add more expenses", "See summary", "Save as PDF", "Set a budget goal", "Back to menu"];
  } else {
    options = ["🎵 Play music", "🎨 Generate image", "📄 Make PDF", "🔥 Post status", "💡 Solve a problem"];
  }

  await new Promise(r => setTimeout(r, 1500));
  await sendPoll(sock, jid, question, options);
}

// ─── Real-life problem solvers ────────────────────────────────────────────────

// 1. Budget / Expense Tracker
async function budgetHelper(sock, jid, text) {
  const resp = await askGroq(
    `You are a Nigerian personal finance assistant. Help the user track expenses, budget, or understand their spending.
Format clearly with NGN (₦) amounts.
If they list expenses, give: total spent, suggested savings, where they're overspending, practical advice.
Be direct and helpful, max 300 words.`,
    text, []
  );
  return resp;
}

// 2. Job Application Drafter
async function jobHelper(sock, jid, text) {
  // Send options poll first
  await sendPoll(sock, jid, "What do you need for the job?", [
    "Write cover letter",
    "Improve my CV",
    "Prepare for interview",
    "Write LinkedIn bio",
    "Draft follow-up email",
  ]);
  return null; // Response handled when poll vote comes in
}

// 3. Business Idea / Name Generator
async function businessHelper(text) {
  return askGroq(
    `You are a Nigerian business consultant. Generate practical, creative business ideas or names.
Consider the Nigerian market, local trends, startup costs, and real profitability.
Give specific names with brief explanations. Be realistic and actionable.`,
    text, []
  );
}

// 4. Homework / Study Helper
async function studyHelper(text) {
  return askGroq(
    `You are a brilliant tutor. Explain concepts clearly, solve problems step-by-step, and make learning easy.
For maths: show every step. For essays: give structure and key points. For science: use simple analogies.
Be thorough but easy to understand. Max 400 words.`,
    text, []
  );
}

// 5. Relationship / Personal Advice
async function adviceHelper(text) {
  return askGroq(
    `You are a wise, empathetic personal advisor. Give honest, practical life advice.
Don't be preachy. Be real, understanding, and solution-focused.
Consider Nigerian cultural context where relevant. Max 250 words.`,
    text, []
  );
}

// 6. Health Symptom Checker (general info only — NOT diagnosis)
async function healthHelper(text) {
  return askGroq(
    `You are a helpful health information assistant (NOT a doctor).
Give general information about symptoms, when to see a doctor, and practical home care tips.
ALWAYS end with: "This is general information only — please see a qualified doctor for proper diagnosis."
Max 250 words.`,
    text, []
  );
}

// 7. Decode a WhatsApp scam / suspicious link
async function scamChecker(text) {
  return askGroq(
    `You are a Nigerian cybersecurity expert. Analyze this message/link for scam signals.
Look for: urgency tactics, prize claims, request for personal info, suspicious links, too-good-to-be-true offers.
Give a clear verdict: LIKELY SCAM / MIGHT BE LEGIT / SAFE, and explain why. Be direct. Max 200 words.`,
    text, []
  );
}

// ─── Detect which problem solver to use ──────────────────────────────────────
function detectProblemType(text) {
  const t = text.toLowerCase();
  if (/budget|expense|spent|spending|salary|save|saving|income|broke|money|naira|₦/i.test(t))         return "budget";
  if (/job|cv|resume|interview|cover.?letter|apply|career|hire|employment/i.test(t))                  return "job";
  if (/business.*idea|name.*business|startup|sell|product.*name|brand.*name/i.test(t))                return "business";
  if (/homework|study|exam|school|university|calculate|solve|equation|essay|explain/i.test(t))        return "study";
  if (/relationship|partner|boyfriend|girlfriend|marriage|breakup|advice.*life|family|friend.*drama/i.test(t)) return "advice";
  if (/symptom|sick|pain|fever|headache|stomach|health|medication|drug|dose/i.test(t))                return "health";
  if (/scam|fraud|suspicious|hack|phishing|fake|too good/i.test(t))                                   return "scam";
  return null;
}

// ─── Handle poll vote ─────────────────────────────────────────────────────────
// Called from index.js when a pollUpdate event fires
function pollOptionToText(option) {
  // Strip emoji from start for routing
  return String(option || "")
    .replace(/^[\u{1F300}-\u{1FFFF}\u{2600}-\u{26FF}✅❌🎵📹💬🎨📄💡📸📊💼🔥👋🌟⚡💎🤖]\s*/gu, "")
    .toLowerCase()
    .trim();
}

module.exports = { sendPoll, sendWelcomeMenu, sendSuggestions, budgetHelper, jobHelper, businessHelper, studyHelper, adviceHelper, healthHelper, scamChecker, detectProblemType, pollOptionToText };
