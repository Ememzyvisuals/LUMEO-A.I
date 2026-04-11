/**
 * lumeo_db.js — Supabase Database Layer
 * EMEMZYVISUALS DIGITALS | Emmanuel.A
 */
"use strict";

require("dotenv").config();
const https = require("https");

const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || "";

// ─── Generic Supabase REST request ───────────────────────────────────────────
function supaReq(method, path, body = null) {
  return new Promise((resolve, reject) => {
    if (!SUPABASE_URL || !SUPABASE_KEY) return resolve(null);
    const url   = new URL(SUPABASE_URL + "/rest/v1" + path);
    const data  = body ? JSON.stringify(body) : null;
    const req   = https.request({
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method,
      headers: {
        "apikey":        SUPABASE_KEY,
        "Authorization": "Bearer " + SUPABASE_KEY,
        "Content-Type":  "application/json",
        "Prefer":        method === "POST" ? "return=minimal" : "return=representation",
        ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
      },
      timeout: 8000,
    }, (res) => {
      let raw = "";
      res.on("data", c => raw += c);
      res.on("end", () => {
        try { resolve(raw ? JSON.parse(raw) : null); }
        catch { resolve(null); }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
    if (data) req.write(data);
    req.end();
  });
}

// ─── Memory ───────────────────────────────────────────────────────────────────
async function dbSaveMemory(phone, role, content) {
  return supaReq("POST", "/lumeo_memory", { phone, role, content: String(content).slice(0, 2000) });
}

async function dbGetMemory(phone, limit = 40) {
  const data = await supaReq("GET",
    `/lumeo_memory?phone=eq.${phone}&order=created_at.desc&limit=${limit}`);
  if (!Array.isArray(data)) return [];
  const cutoff = Date.now() - 48 * 60 * 60 * 1000;
  return data
    .filter(m => !m.created_at || new Date(m.created_at).getTime() > cutoff)
    .reverse();
}

async function dbClearMemory(phone) {
  return supaReq("DELETE", `/lumeo_memory?phone=eq.${phone}`);
}

// ─── Users ────────────────────────────────────────────────────────────────────
async function dbGetUser(phone) {
  const data = await supaReq("GET", `/lumeo_users?phone=eq.${phone}&limit=1`);
  return Array.isArray(data) && data[0] ? data[0] : null;
}

async function dbUpsertUser(phone, fields = {}) {
  return supaReq("POST", "/lumeo_users", { phone, ...fields });
}

async function dbUpdateUser(phone, fields = {}) {
  return supaReq("PATCH", `/lumeo_users?phone=eq.${phone}`, fields);
}

async function dbGetAllUsers() {
  const data = await supaReq("GET", "/lumeo_users?select=phone,name,banned&limit=1000");
  return Array.isArray(data) ? data : [];
}

// ─── Marketing campaigns ──────────────────────────────────────────────────────
async function dbSaveCampaign(campaign) {
  return supaReq("POST", "/lumeo_campaigns", campaign);
}

async function dbGetCampaigns() {
  const data = await supaReq("GET", "/lumeo_campaigns?order=created_at.desc&limit=50");
  return Array.isArray(data) ? data : [];
}

// ─── Brain / misc key-value ───────────────────────────────────────────────────
async function dbGetBrain(key) {
  const data = await supaReq("GET", `/lumeo_brain?key=eq.${encodeURIComponent(key)}&limit=1`);
  return Array.isArray(data) && data[0] ? data[0].value : null;
}

async function dbSetBrain(key, value) {
  return supaReq("POST", "/lumeo_brain", { key, value, updated_at: new Date().toISOString() });
}

module.exports = {
  dbSaveMemory, dbGetMemory, dbClearMemory,
  dbGetUser, dbUpsertUser, dbUpdateUser, dbGetAllUsers,
  dbSaveCampaign, dbGetCampaigns,
  dbGetBrain, dbSetBrain,
};
