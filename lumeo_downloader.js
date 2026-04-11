/**
 * lumeo_downloader.js — Multi-Platform Media Downloader
 * EMEMZYVISUALS DIGITALS | Emmanuel.A
 *
 * YouTube by URL   → @distube/ytdl-core (most reliable for Node.js)
 *                  → Cobalt API fallback
 * TikTok/IG/FB/X  → Cobalt API → yt-dlp fallback
 * Music by name    → SoundCloud (scsearch1:) — sends audio + cover + lyrics
 */
"use strict";

const fs    = require("fs");
const path  = require("path");
const https = require("https");
const http  = require("http");

const TMP = "/tmp";

// ─── Platform detection ───────────────────────────────────────────────────────
function detectPlatform(q) {
  const urlMatch = q.match(/https?:\/\/[^\s]+/);
  const url = urlMatch ? urlMatch[0] : null;
  if (url) {
    if (/youtube\.com|youtu\.be/i.test(url))  return { isUrl: true, url, platform: "youtube"  };
    if (/tiktok\.com/i.test(url))             return { isUrl: true, url, platform: "tiktok"   };
    if (/instagram\.com/i.test(url))          return { isUrl: true, url, platform: "instagram"};
    if (/twitter\.com|x\.com/i.test(url))     return { isUrl: true, url, platform: "twitter"  };
    if (/facebook\.com|fb\.watch/i.test(url)) return { isUrl: true, url, platform: "facebook" };
    if (/soundcloud\.com/i.test(url))         return { isUrl: true, url, platform: "soundcloud"};
    return { isUrl: true, url, platform: "generic" };
  }
  const hint = (q.match(/\b(tiktok|instagram|youtube|soundcloud|facebook|twitter)\b/i) || [])[1]?.toLowerCase();
  return { isUrl: false, url: null, platform: hint || "search" };
}

function cleanQuery(raw) {
  const urlMatch = raw.match(/https?:\/\/[^\s]+/);
  if (urlMatch) return urlMatch[0].trim();
  return raw
    .replace(/\b(download|play|get me|send me|grab|search for|find me|for me)\b/gi, "")
    .replace(/\b(on|from) (youtube|tiktok|instagram|soundcloud|facebook|twitter)\b/gi, "")
    .replace(/\b(this video|this audio|this song|this music|this clip|the video|the song|for me)\b/gi, "")
    .replace(/\s+/g, " ").trim();
}

// ─── Cobalt API (community instances) ────────────────────────────────────────
const COBALT = [
  "https://dwnld.nichind.dev",
  "https://cobalt.canine.tools",
  "https://cobalt.meowing.de",
  "https://co.wuk.sh",
  "https://api.cobalt.tools",
];

async function cobaltGet(url, audioOnly = false) {
  for (const inst of COBALT) {
    try {
      const body = JSON.stringify({ url, videoQuality:"720", downloadMode:audioOnly?"audio":"auto", audioFormat:audioOnly?"mp3":"best", filenameStyle:"basic" });
      const u    = new URL(inst);
      const res  = await new Promise((resolve, reject) => {
        const req = https.request({ hostname:u.hostname, path:"/", method:"POST",
          headers:{ "Content-Type":"application/json","Accept":"application/json","User-Agent":"LumeoAI/3.0","Content-Length":Buffer.byteLength(body) },
          timeout:12000,
        }, r => {
          let d = ""; r.on("data",c=>d+=c);
          r.on("end",()=>{ try{ resolve({ok:r.statusCode===200,data:JSON.parse(d)}); }catch{ resolve({ok:false}); } });
        });
        req.on("error",reject); req.on("timeout",()=>{ req.destroy(); reject(new Error("timeout")); });
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
    function get(u, hops=0) {
      if (hops>6) return reject(new Error("Too many redirects"));
      const proto = u.startsWith("https") ? https : http;
      proto.get(u, { headers:{"User-Agent":"Mozilla/5.0 LumeoBot/3.0"}, timeout:120000 }, res => {
        if ([301,302,307,308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          const next = res.headers.location.startsWith("http") ? res.headers.location : new URL(res.headers.location, u).href;
          return get(next, hops+1);
        }
        if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
        const ws = fs.createWriteStream(outPath);
        res.pipe(ws); ws.on("finish",resolve); ws.on("error",reject);
      }).on("error",reject).on("timeout",function(){ this.destroy(); reject(new Error("timeout")); });
    }
    get(url);
  });
}

// ─── yt-dlp helper ───────────────────────────────────────────────────────────
function ytdlp() { try { return require("youtube-dl-exec"); } catch { return null; } }
function findFile(ts,...exts) {
  for (const ext of exts) {
    const f = path.join(TMP, `lumeo_${ts}${ext}`);
    if (fs.existsSync(f) && fs.statSync(f).size > 500) return f;
  }
  return null;
}

// ─── YouTube download via @distube/ytdl-core ─────────────────────────────────
async function ytdlCoreDownload(url, audioOnly, ts) {
  try {
    const ytdl   = require("@distube/ytdl-core");
    const outExt = audioOnly ? ".mp3" : ".mp4";
    const outPath = path.join(TMP, `lumeo_${ts}${outExt}`);

    const info    = await ytdl.getBasicInfo(url);
    const title   = info.videoDetails?.title || "video";
    const thumbUrl = info.videoDetails?.thumbnails?.pop()?.url || null;

    await new Promise((resolve, reject) => {
      const filter = audioOnly ? "audioonly" : (format) => format.container === "mp4" && format.hasVideo;
      const stream = ytdl(url, { quality: audioOnly ? "highestaudio" : "highest", filter });
      const ws     = fs.createWriteStream(outPath);
      stream.pipe(ws);
      ws.on("finish", resolve);
      ws.on("error", reject);
      stream.on("error", reject);
    });

    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 1000) {
      console.log(`[ytdl-core] ✅ ${title.slice(0,50)} — ${(fs.statSync(outPath).size/1024/1024).toFixed(1)}MB`);
      return { success:true, path:outPath, title, thumbUrl };
    }
  } catch (e) {
    console.log("[ytdl-core] Error:", e.message.slice(0,100));
  }
  return null;
}

// ─── Download audio (music) ──────────────────────────────────────────────────
async function downloadAudio(rawQuery) {
  const query   = cleanQuery(rawQuery);
  const { isUrl, url, platform } = detectPlatform(rawQuery);
  const ts      = Date.now();
  const yt      = ytdlp();

  console.log(`[Download] 🎵 Audio: "${query.slice(0,60)}" platform=${platform}`);

  // URL + YouTube → ytdl-core first
  if (isUrl && url && platform === "youtube") {
    const r = await ytdlCoreDownload(url, true, ts);
    if (r?.success) {
      // Fetch thumbnail
      let thumbBuf = null;
      if (r.thumbUrl) {
        try {
          const tb = await new Promise((resolve) => {
            https.get(r.thumbUrl, { timeout:8000 }, res => {
              const chunks=[]; res.on("data",c=>chunks.push(c)); res.on("end",()=>resolve(Buffer.concat(chunks)));
            }).on("error",()=>resolve(null)).on("timeout",function(){ this.destroy(); resolve(null); });
          });
          if (tb?.length > 1000) thumbBuf = tb;
        } catch {}
      }
      const buf = fs.readFileSync(r.path);
      return { success:true, audioBuf:buf, thumbBuf, title:r.title, cleanup:()=>{ try{ fs.unlinkSync(r.path); }catch{} } };
    }
  }

  // URL + other platform → Cobalt
  if (isUrl && url) {
    const cobaltUrl = await cobaltGet(url, true);
    if (cobaltUrl) {
      const out = path.join(TMP, `lumeo_${ts}.mp3`);
      try {
        await streamToFile(cobaltUrl, out);
        if (fs.existsSync(out) && fs.statSync(out).size > 1000) {
          return { success:true, audioBuf:fs.readFileSync(out), thumbBuf:null, cleanup:()=>{ try{fs.unlinkSync(out);}catch{} } };
        }
      } catch {}
    }
  }

  // Search by name → SoundCloud (exact title first to avoid remixes)
  if (!isUrl && yt) {
    const cleanTitle = query.replace(/\b(remix|cover|mix|version|edit)\b.*/i,"").trim();
    const searches   = cleanTitle !== query && cleanTitle.length > 2 ? [cleanTitle, query] : [query];

    for (const q of searches) {
      const ts2 = Date.now();
      const tm2 = path.join(TMP, `lumeo_${ts2}.%(ext)s`);
      console.log(`[Download] SoundCloud: "${q.slice(0,55)}"`);
      try {
        await yt.exec(`scsearch1:${q}`, {
          noPlaylist:true, extractAudio:true, audioFormat:"mp3", audioQuality:5,
          embedThumbnail:true, addMetadata:true, writeThumbnail:true,
          convertThumbnails:"jpg", output:tm2, noWarnings:true, ignoreErrors:true,
        }, { timeout:120000 });

        const f = findFile(ts2, ".mp3", ".m4a", ".webm", ".opus");
        const j = findFile(ts2, ".jpg", ".jpeg");
        if (f) {
          console.log(`[Download] ✅ SoundCloud: ${(fs.statSync(f).size/1024).toFixed(0)}KB`);
          return {
            success:true, audioBuf:fs.readFileSync(f), thumbBuf:j?fs.readFileSync(j):null, title:q,
            cleanup:()=>{ [f,j].filter(Boolean).forEach(x=>{ try{fs.unlinkSync(x);}catch{} }); },
          };
        }
      } catch (e) { console.log("[SC]", (e.stderr||e.message).slice(0,100)); }
    }
  }

  return { success:false, error:"Couldn't find that song. Try adding the artist name!" };
}

// ─── Download video ───────────────────────────────────────────────────────────
async function downloadVideo(rawQuery) {
  const query   = cleanQuery(rawQuery);
  const { isUrl, url, platform } = detectPlatform(rawQuery);
  const ts      = Date.now();
  const yt      = ytdlp();
  const MAX     = 64 * 1024 * 1024;

  console.log(`[Download] 🎬 Video: "${query.slice(0,60)}" platform=${platform}`);

  function pkg(f, j) {
    if (!f) return null;
    const size = fs.statSync(f).size;
    if (size > MAX) { try{fs.unlinkSync(f);}catch{} return {success:false,error:"Video too large for WhatsApp (max 64MB). Try a shorter clip!"}; }
    console.log(`[Download] ✅ Video: ${(size/1024/1024).toFixed(1)}MB`);
    return { success:true, videoBuf:fs.readFileSync(f), thumbBuf:j?fs.readFileSync(j):null, cleanup:()=>{ [f,j].filter(Boolean).forEach(x=>{ try{fs.unlinkSync(x);}catch{} }); } };
  }

  // YouTube URL → ytdl-core first (most reliable)
  if (isUrl && url && platform === "youtube") {
    console.log("[Download] YouTube → @distube/ytdl-core");
    const r = await ytdlCoreDownload(url, false, ts);
    if (r?.success) {
      const result = pkg(r.path, null);
      if (result) return result;
    }
    // Cobalt fallback
    const cobaltUrl = await cobaltGet(url, false);
    if (cobaltUrl) {
      const out = path.join(TMP, `lumeo_${ts}.mp4`);
      try {
        await streamToFile(cobaltUrl, out);
        const result = pkg(fs.existsSync(out)&&fs.statSync(out).size>1000?out:null, null);
        if (result) return result;
      } catch {}
    }
    return { success:false, error:"YouTube blocked the download. YouTube has strict bot detection on servers. Try a TikTok or Instagram link instead!" };
  }

  // Other platforms → Cobalt first
  if (isUrl && url) {
    const cobaltUrl = await cobaltGet(url, false);
    if (cobaltUrl) {
      const out = path.join(TMP, `lumeo_${ts}.mp4`);
      try {
        await streamToFile(cobaltUrl, out);
        const result = pkg(fs.existsSync(out)&&fs.statSync(out).size>1000?out:null, null);
        if (result) return result;
      } catch (e) { console.log("[Cobalt]", e.message); }
    }
    // yt-dlp fallback
    if (yt) {
      const tmpl = path.join(TMP, `lumeo_${ts}.%(ext)s`);
      try {
        await yt.exec(url, {
          noPlaylist:true,
          format:"bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best[ext=mp4]/best",
          mergeOutputFormat:"mp4", output:tmpl, noWarnings:true, ignoreErrors:true, noCheckCertificates:true,
        }, { timeout:240000 });
        const f = findFile(ts, ".mp4", ".webm", ".mkv");
        const j = findFile(ts, ".jpg", ".jpeg");
        if (f) return pkg(f,j) || {success:false,error:"Video too large"};
      } catch (e) { console.log("[yt-dlp]", (e.stderr||e.message).slice(0,100)); }
    }
    return { success:false, error:"Couldn't download that video. Make sure the link is public and accessible!" };
  }

  // Search by name → try yt-dlp search
  if (yt) {
    const searchSrc = platform==="tiktok" ? `ytsearch1:${query} tiktok` : `ytsearch1:${query}`;
    const tmpl = path.join(TMP, `lumeo_${ts}.%(ext)s`);
    console.log(`[Download] Searching: "${searchSrc.slice(0,60)}"`);
    try {
      await yt.exec(searchSrc, {
        noPlaylist:true,
        format:"bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480][ext=mp4]/best[ext=mp4]/best",
        mergeOutputFormat:"mp4", output:tmpl, noWarnings:true, ignoreErrors:true, noCheckCertificates:true,
      }, { timeout:180000 });
      const f = findFile(ts, ".mp4", ".webm", ".mkv");
      const j = findFile(ts, ".jpg", ".jpeg");
      if (f) return pkg(f,j) || {success:false,error:"Video too large"};
    } catch (e) { console.log("[VideoSearch]", (e.stderr||e.message).slice(0,100)); }
  }

  return { success:false, error:"Couldn't find that video by name. Paste the direct link from TikTok, Instagram, YouTube or Facebook!" };
}

// ─── Main entry ───────────────────────────────────────────────────────────────
async function downloadMedia(rawQuery, type = "music") {
  // Video platform URLs always → downloadVideo
  if (/https?:\/\//i.test(rawQuery) && /youtube\.com|youtu\.be|tiktok|instagram|twitter\.com|x\.com|facebook|fb\.watch/i.test(rawQuery)) {
    return downloadVideo(rawQuery);
  }
  // Platform hint in text → video
  if (!/https?:\/\//i.test(rawQuery) && /\b(tiktok|youtube|instagram|facebook)\b/i.test(rawQuery)) {
    return downloadVideo(rawQuery);
  }
  return type === "video" ? downloadVideo(rawQuery) : downloadAudio(rawQuery);
}

module.exports = { downloadMedia, cleanQuery, detectPlatform };
