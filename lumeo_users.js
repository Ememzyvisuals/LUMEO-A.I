/**
 * lumeo_users.js — User Management & Memory
 * EMEMZYVISUALS DIGITALS | Emmanuel.A
 */
"use strict";

const { dbSaveMemory, dbGetMemory, dbClearMemory, dbGetUser, dbUpsertUser, dbUpdateUser } = require("./lumeo_db");

// In-memory cache
const _userCache  = new Map(); // phone → user record
const _memCache   = new Map(); // phone → messages[]
const _msgCount   = new Map(); // phone → {count, date}

// ─── User get/create ──────────────────────────────────────────────────────────
async function getUser(phone) {
  if (_userCache.has(phone)) return _userCache.get(phone);
  let user = await dbGetUser(phone);
  if (!user) {
    user = { phone, name: null, language: "english", persona: "casual", notes: "", warnings: 0, banned: false, message_count: 0 };
    await dbUpsertUser(phone, user).catch(() => {});
  }
  _userCache.set(phone, user);
  return user;
}

async function updateUserName(phone, name) {
  if (!name) return;
  const user = await getUser(phone);
  if (user.name !== name) {
    user.name = name;
    _userCache.set(phone, user);
    await dbUpdateUser(phone, { name }).catch(() => {});
  }
}

async function banUser(phone, reason = "") {
  const user = await getUser(phone);
  user.banned = true;
  _userCache.set(phone, user);
  await dbUpdateUser(phone, { banned: true, ban_reason: reason }).catch(() => {});
}

async function isBanned(phone) {
  const user = await getUser(phone);
  return !!user.banned;
}

// ─── Memory ───────────────────────────────────────────────────────────────────
async function addMemory(phone, role, content) {
  const msg = { role, content: String(content).slice(0, 1000), time: Date.now() };
  const arr = _memCache.get(phone) || [];
  arr.push(msg);
  // Keep last 100 in memory
  if (arr.length > 100) arr.splice(0, arr.length - 100);
  _memCache.set(phone, arr);
  // Save to Supabase async
  dbSaveMemory(phone, role, msg.content).catch(() => {});
}

async function getHistory(phone, limit = 40) {
  // Try memory cache first
  let arr = _memCache.get(phone) || [];

  // If cache is empty, load from Supabase
  if (arr.length === 0) {
    const rows = await dbGetMemory(phone, limit).catch(() => []);
    if (rows.length > 0) {
      _memCache.set(phone, rows.map(r => ({ role: r.role, content: r.content, time: new Date(r.created_at).getTime() })));
      arr = _memCache.get(phone);
    }
  }

  // Format for Groq
  return arr.slice(-limit).map(m => ({ role: m.role, content: m.content }));
}

async function clearMemory(phone) {
  _memCache.delete(phone);
  await dbClearMemory(phone).catch(() => {});
}

// ─── Rate limiting ────────────────────────────────────────────────────────────
const DAILY_LIMIT = 30; // messages per day per user

function checkRateLimit(phone) {
  const today    = new Date().toDateString();
  const state    = _msgCount.get(phone) || { count: 0, date: today };
  if (state.date !== today) { state.count = 0; state.date = today; }
  state.count++;
  _msgCount.set(phone, state);
  return state.count > DAILY_LIMIT;
}

// ─── Known users list (for marketing) ────────────────────────────────────────
function cacheUser(phone, name) {
  const existing = _userCache.get(phone) || {};
  _userCache.set(phone, { ...existing, phone, name: name || existing.name });
}

function getAllCachedPhones() {
  return [..._userCache.keys()];
}

module.exports = {
  getUser, updateUserName, banUser, isBanned,
  addMemory, getHistory, clearMemory,
  checkRateLimit, cacheUser, getAllCachedPhones,
};
