/**
 * lumeo_competition.js — AI vs AI Competition Module
 * EMEMZYVISUALS DIGITALS | Emmanuel.A
 *
 * Allows Lumeo to run competitions against Meta AI (or any other AI) in groups.
 * Emmanuel controls it, Lumeo moderates it.
 *
 * Usage:
 *   "start competition: [topic]"   — begin a new round
 *   "end competition"              — declare results
 *   "next round"                   — move to next challenge
 *   "judge [criteria]"             — Lumeo evaluates responses
 *
 * How it works:
 *   1. Emmanuel starts competition in group
 *   2. Lumeo posts the challenge to the group
 *   3. Meta AI responds (as it normally would from @Meta AI tag)
 *   4. Lumeo also gives its own answer
 *   5. Group members vote or Lumeo scores them
 *   6. Lumeo announces winner
 */
"use strict";

const { askGroq } = require("./ai");

// Active competitions per group
const _competitions = new Map();

// ─── Start competition ────────────────────────────────────────────────────────
async function startCompetition(groupJid, topic, devName) {
  const comp = {
    groupJid,
    topic:      topic.trim(),
    round:      1,
    scores:     { lumeo: 0, metaAI: 0 },
    history:    [],
    started:    Date.now(),
    active:     true,
    challenges: await generateChallenges(topic),
  };
  _competitions.set(groupJid, comp);

  const firstChallenge = comp.challenges[0];
  const announcement = `🏆 *AI SHOWDOWN — ROUND 1* 🏆\n\n` +
    `*Lumeo AI* 🤖 vs *Meta AI* 🔵\n` +
    `Organized by ${devName || "Emmanuel.A"} | Moderated by Lumeo\n\n` +
    `*Topic:* ${topic}\n\n` +
    `*CHALLENGE 1:*\n${firstChallenge}\n\n` +
    `_Both AIs will now respond. Group members can also vote!_\n` +
    `_Tag @Lumeo or @Meta AI to ask follow-up questions_ 🎯`;

  return { announcement, challenge: firstChallenge };
}

// ─── Generate challenges based on topic ──────────────────────────────────────
async function generateChallenges(topic) {
  const resp = await askGroq(
    "Generate 5 creative competition challenges for an AI vs AI showdown. Each challenge should test a different skill (creativity, knowledge, humor, problem-solving, speed). Format as a numbered list. Be specific and interesting.",
    `Topic: ${topic}. Make challenges suitable for WhatsApp group entertainment.`,
    []
  );

  if (resp) {
    const lines = resp.split("\n").filter(l => /^\d+\./.test(l.trim())).map(l => l.replace(/^\d+\.\s*/, "").trim());
    if (lines.length >= 3) return lines;
  }

  // Fallback challenges
  return [
    `Best explanation of "${topic}" in under 50 words`,
    `Most creative use of "${topic}" in a story`,
    `Funniest joke about "${topic}"`,
    `Most practical advice about "${topic}"`,
    `Best poem about "${topic}"`,
  ];
}

// ─── Lumeo responds to current challenge ─────────────────────────────────────
async function lumeoRespond(groupJid, lumeoSystemPrompt) {
  const comp = _competitions.get(groupJid);
  if (!comp || !comp.active) return null;

  const challenge = comp.challenges[comp.round - 1];
  if (!challenge) return null;

  const resp = await askGroq(
    lumeoSystemPrompt + "\n\nYou're in a friendly AI competition. Give your absolute BEST response. Be impressive, creative, and show what you can do. This is your chance to shine!",
    `COMPETITION CHALLENGE: ${challenge}\n\nGive your best response to win this round! Be creative, impressive and memorable.`,
    []
  );

  return resp;
}

// ─── Judge a round ────────────────────────────────────────────────────────────
async function judgeRound(groupJid, lumeoAnswer, metaAIAnswer) {
  const comp = _competitions.get(groupJid);
  if (!comp) return null;

  const challenge = comp.challenges[comp.round - 1];
  const judgment  = await askGroq(
    "You are an impartial AI competition judge. Be fair, entertaining, and give clear scores out of 10.",
    `CHALLENGE: ${challenge}\n\nLUMEO AI answered: "${lumeoAnswer?.slice(0, 400) || "No answer given"}"\n\nMETA AI answered: "${metaAIAnswer?.slice(0, 400) || "No answer given"}"\n\nScore each out of 10 on: creativity, accuracy, helpfulness. Declare a winner for this round with brief reasoning. Keep it entertaining for the group!`,
    []
  );

  // Parse scores (simple heuristic)
  let lumeoScore = 0, metaScore = 0;
  if (judgment) {
    const lumeoMatch = judgment.match(/lumeo[^:]*:\s*(\d+)/i);
    const metaMatch  = judgment.match(/meta[^:]*:\s*(\d+)/i);
    lumeoScore = lumeoMatch ? parseInt(lumeoMatch[1]) : 5;
    metaScore  = metaMatch  ? parseInt(metaMatch[1])  : 5;
  }

  comp.scores.lumeo  += lumeoScore;
  comp.scores.metaAI += metaScore;
  comp.history.push({ round: comp.round, challenge, lumeoScore, metaScore });

  return {
    judgment,
    lumeoScore,
    metaScore,
    roundSummary: `*Round ${comp.round} Score:*\n🤖 Lumeo: ${lumeoScore}/10\n🔵 Meta AI: ${metaScore}/10`,
  };
}

// ─── Next round ───────────────────────────────────────────────────────────────
function nextRound(groupJid) {
  const comp = _competitions.get(groupJid);
  if (!comp || !comp.active) return null;

  comp.round++;
  if (comp.round > comp.challenges.length) {
    return { done: true };
  }

  const nextChallenge = comp.challenges[comp.round - 1];
  const msg = `⚔️ *ROUND ${comp.round}!*\n\n` +
    `*Running Score:*\n🤖 Lumeo: ${comp.scores.lumeo}\n🔵 Meta AI: ${comp.scores.metaAI}\n\n` +
    `*CHALLENGE ${comp.round}:*\n${nextChallenge}\n\n` +
    `_Both AIs respond now!_`;

  return { msg, challenge: nextChallenge, done: false };
}

// ─── End competition ──────────────────────────────────────────────────────────
async function endCompetition(groupJid) {
  const comp = _competitions.get(groupJid);
  if (!comp) return "No active competition in this group.";

  comp.active = false;
  _competitions.delete(groupJid);

  const winner = comp.scores.lumeo > comp.scores.metaAI ? "🤖 LUMEO AI"
               : comp.scores.metaAI > comp.scores.lumeo ? "🔵 META AI"
               : "🤝 IT'S A TIE";

  const finalJudgment = await askGroq(
    "You are the competition host. Write an exciting, entertaining final announcement for an AI competition.",
    `Competition topic: ${comp.topic}\nFinal scores — Lumeo AI: ${comp.scores.lumeo}, Meta AI: ${comp.scores.metaAI}\nWinner: ${winner}\nWrite a fun, energetic closing announcement. Mention EMEMZYVISUALS DIGITALS.`,
    []
  );

  return `🏆 *COMPETITION OVER!* 🏆\n\n` +
    `*FINAL SCORES:*\n🤖 Lumeo AI: ${comp.scores.lumeo}\n🔵 Meta AI: ${comp.scores.metaAI}\n\n` +
    `*WINNER: ${winner}*\n\n` +
    (finalJudgment || "Thanks for competing! Powered by EMEMZYVISUALS DIGITALS 🚀") +
    `\n\n_Competition moderated by Lumeo AI — EMEMZYVISUALS DIGITALS_`;
}

// ─── Get active competition ───────────────────────────────────────────────────
function getCompetition(groupJid) { return _competitions.get(groupJid) || null; }
function isCompetitionActive(groupJid) { return !!_competitions.get(groupJid)?.active; }

module.exports = { startCompetition, lumeoRespond, judgeRound, nextRound, endCompetition, getCompetition, isCompetitionActive };
