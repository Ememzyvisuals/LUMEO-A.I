/**
 * lumeo_competition.js — Lumeo vs Meta AI Competition
 * EMEMZYVISUALS DIGITALS | Emmanuel.A
 *
 * FULLY AUTOMATED — Emmanuel says "start competition [topic]"
 * Lumeo does everything:
 *   1. Finds Meta AI's JID in the group
 *   2. Posts the challenge + tags Meta AI
 *   3. Listens for Meta AI's response (messages from Meta AI JID)
 *   4. Gives its own answer
 *   5. Judges both answers automatically
 *   6. Announces winner
 *   7. Next round automatically (3 rounds by default)
 *
 * Meta AI WhatsApp JID: 13135550002@s.whatsapp.net (US number)
 * In groups, Meta AI's participant JID is detected automatically
 */
"use strict";

const { askGroq } = require("./ai");

// Competition state per group
const _active = new Map();

// Known Meta AI JIDs (varies by region — we detect from group participants)
const META_AI_NUMBERS = [
  "13135550002", // US Meta AI
  "15550199999", // Alt US
];

// ─── Detect Meta AI in group participants ────────────────────────────────────
async function findMetaAIJid(sock, groupJid) {
  try {
    const meta = await sock.groupMetadata(groupJid);
    const participants = meta.participants || [];
    for (const p of participants) {
      const num = (p.id || "").split("@")[0];
      if (META_AI_NUMBERS.includes(num)) return p.id;
      // Also check if participant name is Meta AI
      if (/meta.?ai/i.test(p.name || "")) return p.id;
    }
    // Last resort: return the known US JID (works in most regions)
    return "13135550002@s.whatsapp.net";
  } catch {
    return "13135550002@s.whatsapp.net";
  }
}

// ─── Generate 3 challenges for the competition ───────────────────────────────
async function makeChallenges(topic) {
  const resp = await askGroq(
    "Generate exactly 3 competition challenges. Each tests a different skill (knowledge, creativity, humor or problem-solving). Each challenge must be a single clear question or task. Short. Numbered 1, 2, 3. No extra text.",
    "Topic: " + topic,
    []
  );

  const lines = (resp || "").split("\n")
    .filter(l => /^\d+/.test(l.trim()))
    .map(l => l.replace(/^\d+[.)]\s*/, "").trim())
    .filter(Boolean);

  if (lines.length >= 2) return lines.slice(0, 3);

  return [
    "Best explanation of '" + topic + "' in 3 sentences",
    "Most creative real-world use of '" + topic + "'",
    "Best advice about '" + topic + "' for a Nigerian entrepreneur",
  ];
}

// ─── Start competition ────────────────────────────────────────────────────────
async function startCompetition(sock, groupJid, topic, sysPrompt, devMentions) {
  const metaJid    = await findMetaAIJid(sock, groupJid);
  const challenges = await makeChallenges(topic || "Technology and AI");
  const state = {
    groupJid, topic, metaJid,
    challenges,
    round:       0,
    scores:      { lumeo: 0, meta: 0 },
    metaAnswer:  null,
    lumeoAnswer: null,
    waitingMeta: false,
    sysPrompt,
  };
  _active.set(groupJid, state);

  // Start round 1 immediately
  await runRound(sock, groupJid, devMentions);
}

// ─── Run a round (fully automated) ───────────────────────────────────────────
async function runRound(sock, groupJid, devMentions) {
  const state = _active.get(groupJid);
  if (!state) return;
  if (state.round >= state.challenges.length) {
    await endCompetition(sock, groupJid);
    return;
  }

  state.round++;
  state.metaAnswer  = null;
  state.lumeoAnswer = null;
  state.waitingMeta = true;

  const challenge = state.challenges[state.round - 1];
  const metaTag   = "@" + state.metaJid.split("@")[0];
  const totalRounds = state.challenges.length;

  // Post challenge — tag Meta AI directly
  const challengeMsg =
    "⚔️ *AI SHOWDOWN — ROUND " + state.round + " of " + totalRounds + "*\n\n" +
    "*Lumeo AI* 🤖 vs *Meta AI* 🔵\n" +
    "Powered by EMEMZYVISUALS DIGITALS\n\n" +
    "*CHALLENGE:*\n" + challenge + "\n\n" +
    metaTag + " your answer please!\n" +
    "_Lumeo will answer next..._";

  await sock.sendMessage(groupJid, {
    text:     challengeMsg,
    mentions: [state.metaJid, ...(devMentions || [])],
  });

  // Wait 8 seconds then Lumeo gives its own answer
  await new Promise(r => setTimeout(r, 8000));

  // Lumeo answers
  const lumeoAns = await askGroq(
    state.sysPrompt + "\n\nYou are in a competition against Meta AI. Give your absolute best, most impressive answer. Be thorough, creative and show your intelligence. This is your chance to prove you're better!",
    "CHALLENGE: " + challenge + "\n\nGive your best response to win this round!",
    []
  );
  state.lumeoAnswer = lumeoAns || "Lumeo is processing...";

  await sock.sendMessage(groupJid, {
    text: "🤖 *Lumeo AI answers:*\n\n" + state.lumeoAnswer,
  });

  // Wait up to 45 seconds for Meta AI's response, then auto-judge
  let waited = 0;
  const checkInterval = 5000;
  while (waited < 45000 && !state.metaAnswer) {
    await new Promise(r => setTimeout(r, checkInterval));
    waited += checkInterval;
  }

  // Judge the round
  await judgeCurrentRound(sock, groupJid, devMentions);
}

// ─── Called when Meta AI's response is detected ──────────────────────────────
async function onMetaAIResponse(groupJid, message) {
  const state = _active.get(groupJid);
  if (!state || !state.waitingMeta) return;
  state.metaAnswer  = message;
  state.waitingMeta = false;
  console.log("[Competition] Meta AI answered:", message.slice(0, 60));
}

// ─── Judge current round ──────────────────────────────────────────────────────
async function judgeCurrentRound(sock, groupJid, devMentions) {
  const state = _active.get(groupJid);
  if (!state) return;
  state.waitingMeta = false;

  const challenge  = state.challenges[state.round - 1];
  const lumeoAns   = state.lumeoAnswer || "(no answer)";
  const metaAns    = state.metaAnswer  || "(Meta AI didn't respond in time)";

  const judgment = await askGroq(
    "You are a fair, entertaining competition judge. Score each AI out of 10 on accuracy, creativity, helpfulness. Pick a winner. Be specific about what was better. Keep it fun for the group!",
    "CHALLENGE: " + challenge +
    "\n\nLUMEO AI: " + lumeoAns.slice(0, 500) +
    "\n\nMETA AI: " + metaAns.slice(0, 500) +
    "\n\nScore both out of 10. Declare winner with reasoning. One paragraph max.",
    []
  );

  // Parse scores
  let ls = 6, ms = 6;
  if (judgment) {
    const lm = judgment.match(/lumeo[^:0-9]*?(\d+)\s*(?:\/|\s*out\s*of\s*)10/i);
    const mm = judgment.match(/meta[^:0-9]*?(\d+)\s*(?:\/|\s*out\s*of\s*)10/i);
    if (lm) ls = Math.min(10, parseInt(lm[1]));
    if (mm) ms = Math.min(10, parseInt(mm[1]));
  }
  state.scores.lumeo += ls;
  state.scores.meta  += ms;

  const winner = ls > ms ? "🤖 Lumeo AI" : ms > ls ? "🔵 Meta AI" : "🤝 Tie";

  await sock.sendMessage(groupJid, {
    text: "⚖️ *ROUND " + state.round + " VERDICT*\n\n" +
          (judgment || "Both AIs performed well!") + "\n\n" +
          "*Score: Lumeo " + ls + " — Meta AI " + ms + "*\n" +
          "*Round winner: " + winner + "*\n\n" +
          "📊 Total: Lumeo " + state.scores.lumeo + " | Meta AI " + state.scores.meta,
  });

  // Auto-proceed to next round after 5 seconds
  if (state.round < state.challenges.length) {
    await new Promise(r => setTimeout(r, 5000));
    await runRound(sock, groupJid, devMentions);
  } else {
    await endCompetition(sock, groupJid);
  }
}

// ─── End competition ──────────────────────────────────────────────────────────
async function endCompetition(sock, groupJid) {
  const state = _active.get(groupJid);
  if (!state) return;
  _active.delete(groupJid);

  const { lumeo, meta } = state.scores;
  const champion = lumeo > meta ? "🏆 LUMEO AI WINS!" : meta > lumeo ? "🔵 META AI WINS!" : "🤝 IT'S A DRAW!";

  const closingRemark = await askGroq(
    "Write a short exciting closing announcement for an AI competition. Mention EMEMZYVISUALS DIGITALS. Congratulate both AIs. 2-3 sentences max.",
    "Lumeo got " + lumeo + " points, Meta AI got " + meta + ". " + champion,
    []
  );

  await sock.sendMessage(groupJid, {
    text: "🏆 *COMPETITION OVER!*\n\n" +
          "*FINAL SCORES:*\n" +
          "🤖 Lumeo AI: " + lumeo + " points\n" +
          "🔵 Meta AI: " + meta + " points\n\n" +
          "*" + champion + "*\n\n" +
          (closingRemark || "Thanks for watching! Powered by EMEMZYVISUALS DIGITALS 🚀"),
  });
}

// ─── Detect Meta AI message in group ─────────────────────────────────────────
function handleGroupMessage(groupJid, senderJid, text) {
  const state = _active.get(groupJid);
  if (!state || !state.waitingMeta) return false;
  if (!senderJid) return false;

  const senderNum = senderJid.split("@")[0];
  const isMetaAI  = META_AI_NUMBERS.includes(senderNum) ||
                    senderJid === state.metaJid ||
                    /^1313555/i.test(senderNum);

  if (isMetaAI && text) {
    onMetaAIResponse(groupJid, text);
    return true;
  }
  return false;
}

function isActive(groupJid) { return !!_active.get(groupJid); }
function getState(groupJid) { return _active.get(groupJid) || null; }

module.exports = { startCompetition, handleGroupMessage, isActive, getState, judgeCurrentRound };
