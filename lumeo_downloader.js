/**
 * lumeo_downloader.js — Multi-Platform Media Downloader
 * EMEMZYVISUALS DIGITALS | Emmanuel.A
 *
 * Music by name   → SoundCloud (scsearch1:) — no bot detection
 * YouTube by URL  → Cobalt API instances
 * TikTok by name  → yt-dlp search
 * Other URLs      → Cobalt → yt-dlp fallback
 */
"use strict";

const fs    = require("fs");
const path  = require("path");
const https = require("https");
const http  = require("http");

const TMP = "/tmp";

// ─── Platform detection ───────────────────────────────────────────────────────
function detectPlatform(q) {
  const url = q.match(/https?:\/\/[^\s]+/)?.[0];
  if (url) {
    if (/youtube\.com|youtu\.be/i.test(url))  return { isUrl: true, url, platform: "youtube" };
    if (/tiktok\.com/i.test(url))             return { isUrl: true, url, platform: "tiktok" };
    if (/instagram\.com/i.test(url))          return { isUrl: true, url, platform: "instagram" };
    if (/twitter\.com|x\.com/i.test(url))     return { isUrl: true, url, platform: "twitter" };
    if (/facebook\.com|fb\.watch/i.test(url)) return { isUrl: true, url, platform: "facebook" };
    if (/soundcloud\.com/i.test(url))         return { isUrl: true, url, platform: "soundcloud" };
    return { isUrl: true, url, platform: "generic" };
  }
  const hint = q.match(/\b(tiktok|instagram|youtube|soundcloud|facebook|twitter)\b/i)?.[1]?.toLowerCase();
  return { isUrl: false, url: null, platform: hint || "search" };
}

function cleanQuery(raw) {
  // Extract URL if present — always use raw URL
  const url = raw.match(/https?:\/\/[^\s]+/)?.[0];
  if (url) return url;
  return raw
    .replace(/\b(download|play|get me|send me|grab|search for|find me|for me)\b/gi, "")
    .replace(/\b(on|from) (youtube|tiktok|instagram|soundcloud|facebook|twitter)\b/gi, "")
    .replace(/\b(this video|this audio|this song|this music|this clip|the video|the song)\b/gi, "")
    .replace(/\s+/g, " ").trim();
}

// ─── Cobalt API ───────────────────────────────────────────────────────────────
const COBALT_INSTANCES = [
  "https://dwnld.nichind.dev",
  "https://cobalt.canine.tools",
  "https://cobalt.meowing.de",
  "https://co.wuk.sh",
  "https://api.cobalt.tools",
];

async function cobaltGet(url, audioOnly = false) {
  for (const instance of COBALT_INSTANCES) {
    try {
      const body = JSON.stringify({ url, videoQuality: "720", downloadMode: audioOnly ? "audio" : "auto", audioFormat: audioOnly ? "mp3" : "best", filenameStyle: "basic" });
      const u    = new URL(instance);
      const res  = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: u.hostname, path: "/", method: "POST",
          headers: { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "LumeoAI/3.0", "Content-Length": Buffer.byteLength(body) },
          timeout: 12000,
        }, r => {
          let d = ""; r.on("data", c => d += c);
          r.on("end", () => { try { resolve({ ok: r.statusCode === 200, data: JSON.parse(d) }); } catch { resolve({ ok: false }); } });
        });
        req.on("error", reject); req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
        req.write(body); req.end();
      });
      if (res.ok && res.data?.url) { console.log(`[Cobalt] ✅ ${u.hostname.split(".")[0]}`); return res.data.url; }
      if (res.data?.picker?.[0]?.url) return res.data.picker[0].url;
    } catch {}
  }
  return null;
}

// ─── Stream URL to file ───────────────────────────────────────────────────────
function streamToFile(url, outPath) {
  return new Promise((resolve, reject) => {
    function get(u, hops = 0) {
      if (hops > 6) return reject(new Error("Too many redirects"));
      const proto = u.startsWith("https") ? https : http;
      proto.get(u, { headers: { "User-Agent": "Mozilla/5.0 LumeoBot/3.0" }, timeout: 120000 }, res => {
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          return get(res.headers.location.startsWith("http") ? res.headers.location : new URL(res.headers.location, u).href, hops + 1);
        }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
        const ws = fs.createWriteStream(outPath);
        res.pipe(ws);
        ws.on("finish", resolve); ws.on("error", reject);
      }).on("error", reject).on("timeout", function() { this.destroy(); reject(new Error("timeout")); });
    }
    get(url);
  });
}

// ─── yt-dlp helper ───────────────────────────────────────────────────────────
function ytdlp() { try { return require("youtube-dl-exec"); } catch { return null; } }

function findFile(ts, ...exts) {
  for (const ext of exts) {
    const f = path.join(TMP, `lumeo_${ts}${ext}`);
    if (fs.existsSync(f) && fs.statSync(f).size > 500) return f;
  }
  return null;
}

// ─── Download audio ───────────────────────────────────────────────────────────
async function downloadAudio(rawQuery) {
  const query = cleanQuery(rawQuery);
  const { isUrl, url, platform } = detectPlatform(rawQuery);
  const ts    = Date.now();
  const tmpl  = path.join(TMP, `lumeo_${ts}.%(ext)s`);
  const yt    = ytdlp();

  console.log(`[Download] 🎵 Audio: "${query.slice(0, 60)}" platform=${platform}`);

  // URL → try Cobalt first
  if (isUrl && url) {
    const cobaltUrl = await cobaltGet(url, true);
    if (cobaltUrl) {
      const out = path.join(TMP, `lumeo_${ts}.mp3`);
      try {
        await streamToFile(cobaltUrl, out);
        if (fs.existsSync(out) && fs.statSync(out).size > 1000) {
          return { success: true, audioBuf: fs.readFileSync(out), thumbBuf: null, cleanup: () => { try { fs.unlinkSync(out); } catch {} } };
        }
      } catch {}
    }
  }

  // Search by name → SoundCloud
  if (!isUrl && yt) {
    // Strip remix/cover to get original first
    const cleanTitle = query.replace(/\b(remix|cover|mix|version|edit)\b.*/i, "").trim();
    const queries    = cleanTitle !== query ? [cleanTitle, query] : [query];

    for (const q of queries) {
      const ts2 = Date.now();
      const tm2 = path.join(TMP, `lumeo_${ts2}.%(ext)s`);
      console.log(`[Download] SoundCloud: "${q.slice(0, 50)}"`);
      try {
        await yt.exec(`scsearch1:${q}`, {
          noPlaylist: true, extractAudio: true, audioFormat: "mp3", audioQuality: 5,
          embedThumbnail: true, addMetadata: true, writeThumbnail: true,
          convertThumbnails: "jpg", output: tm2, noWarnings: true, ignoreErrors: true,
        }, { timeout: 120000 });
        const f = findFile(ts2, ".mp3", ".m4a", ".webm", ".opus");
        const j = findFile(ts2, ".jpg", ".jpeg");
        if (f) {
          console.log(`[Download] ✅ SoundCloud: ${(fs.statSync(f).size / 1024).toFixed(0)}KB`);
          return { success: true, audioBuf: fs.readFileSync(f), thumbBuf: j ? fs.readFileSync(j) : null,
            cleanup: () => { [f, j].filter(Boolean).forEach(x => { try { fs.unlinkSync(x); } catch {} }); } };
        }
      } catch (e) { console.log("[SC]", (e.stderr || e.message).slice(0, 100)); }
    }
  }

  return { success: false, error: "Could not find that song. Try another name!" };
}

// ─── Download video ───────────────────────────────────────────────────────────
async function downloadVideo(rawQuery) {
  const query = cleanQuery(rawQuery);
  const { isUrl, url, platform } = detectPlatform(rawQuery);
  const ts    = Date.now();
  const yt    = ytdlp();
  const MAX   = 64 * 1024 * 1024;

  console.log(`[Download] 🎬 Video: "${query.slice(0, 60)}" platform=${platform}`);

  function pkg(f, j) {
    if (!f) return null;
    const size = fs.statSync(f).size;
    if (size > MAX) { try { fs.unlinkSync(f); } catch {} return { success: false, error: "Video too large for WhatsApp (max 64MB)" }; }
    console.log(`[Download] ✅ Video: ${(size / 1024 / 1024).toFixed(1)}MB`);
    return { success: true, videoBuf: fs.readFileSync(f), thumbBuf: j ? fs.readFileSync(j) : null,
      cleanup: () => { [f, j].filter(Boolean).forEach(x => { try { fs.unlinkSync(x); } catch {} }); } };
  }

  // URL → Cobalt first
  if (isUrl && url) {
    const cobaltUrl = await cobaltGet(url, false);
    if (cobaltUrl) {
      const out = path.join(TMP, `lumeo_${ts}.mp4`);
      try {
        await streamToFile(cobaltUrl, out);
        const r = pkg(fs.existsSync(out) && fs.statSync(out).size > 1000 ? out : null, null);
        if (r) return r;
      } catch (e) { console.log("[Cobalt]", e.message); }
    }

    // yt-dlp fallback for non-YouTube
    if (yt && platform !== "youtube") {
      const tmpl = path.join(TMP, `lumeo_${ts}.%(ext)s`);
      try {
        await yt.exec(url, {
          noPlaylist: true,
          format: "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[ext=mp4]/best",
          mergeOutputFormat: "mp4", output: tmpl, noWarnings: true, ignoreErrors: true, noCheckCertificates: true,
        }, { timeout: 240000 });
        const f = findFile(ts, ".mp4", ".webm", ".mkv");
        const j = findFile(ts, ".jpg", ".jpeg");
        if (f) return pkg(f, j) || { success: false, error: "Video too large" };
      } catch (e) { console.log("[yt-dlp]", (e.stderr || e.message).slice(0, 100)); }
    }
    return { success: false, error: "Couldn't download that video. Make sure the link is public!" };
  }

  // Search by name → platform-specific
  if (yt) {
    const searchSrc = platform === "tiktok" ? `ytsearch1:${query} tiktok` : `ytsearch1:${query}`;
    const tmpl = path.join(TMP, `lumeo_${ts}.%(ext)s`);
    console.log(`[Download] Searching: ${searchSrc.slice(0, 60)}`);
    try {
      await yt.exec(searchSrc, {
        noPlaylist: true,
        format: "bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best[ext=mp4]/best",
        mergeOutputFormat: "mp4", output: tmpl, noWarnings: true, ignoreErrors: true, noCheckCertificates: true,
      }, { timeout: 180000 });
      const f = findFile(ts, ".mp4", ".webm", ".mkv");
      const j = findFile(ts, ".jpg", ".jpeg");
      if (f) return pkg(f, j) || { success: false, error: "Video too large" };
    } catch (e) { console.log("[VideoSearch]", (e.stderr || e.message).slice(0, 100)); }
  }

  return { success: false, error: "Couldn't find that video by name. Paste the direct link from TikTok, Instagram or YouTube!" };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function downloadMedia(rawQuery, type = "music") {
  const { isUrl, platform } = detectPlatform(rawQuery);
  // Video platforms always go to video download
  if (isUrl && /youtube\.com|youtu\.be|tiktok|instagram|twitter\.com|x\.com|facebook|fb\.watch/i.test(rawQuery)) {
    return downloadVideo(rawQuery);
  }
  // Platform hint from text
  if (!isUrl && /\b(tiktok|youtube|instagram|facebook)\b/i.test(rawQuery)) {
    return downloadVideo(rawQuery);
  }
  return type === "video" ? downloadVideo(rawQuery) : downloadAudio(rawQuery);
}

module.exports = { downloadMedia, cleanQuery, detectPlatform };
