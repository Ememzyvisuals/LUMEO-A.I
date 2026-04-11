/**
 * lumeo_video.js — Video Generation (FFmpeg Slideshow)
 * EMEMZYVISUALS DIGITALS | Emmanuel.A
 */
"use strict";

const { exec }        = require("child_process");
const fs              = require("fs");
const path            = require("path");
const { askGroq }     = require("./ai");
const { generateImage } = require("./ai");

const TMP = "/tmp";

async function generateVideo(prompt) {
  const ts = Date.now();
  console.log(`[Video] 🎬 Generating: "${prompt.slice(0, 60)}"`);

  try {
    // Step 1: Break into 3-4 scenes
    const scenePlan = await askGroq(
      "You are a video director. Break this prompt into 3-4 short scene descriptions for image generation. Return ONLY a JSON array of strings.",
      `Video prompt: "${prompt}"`, []
    );

    let scenes = [];
    try { scenes = JSON.parse((scenePlan || "[]").replace(/```json|```/g, "").trim()); }
    catch { scenes = [prompt, prompt + " closeup", prompt + " wide view"]; }
    if (!Array.isArray(scenes) || scenes.length === 0) scenes = [prompt];
    scenes = scenes.slice(0, 4);

    // Step 2: Generate images for each scene
    const imgPaths = [];
    for (let i = 0; i < scenes.length; i++) {
      console.log(`[Video] 🖼️  Scene ${i + 1}: "${scenes[i].slice(0, 50)}"`);
      const imgBuf = await generateImage(scenes[i] + ", cinematic, high quality, 16:9");
      if (imgBuf) {
        const p = path.join(TMP, `lumeo_vid_scene_${ts}_${i}.jpg`);
        fs.writeFileSync(p, imgBuf);
        imgPaths.push(p);
        console.log(`[Video] ✅ Scene ${i + 1}: ${(imgBuf.length / 1024).toFixed(0)}KB`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    if (imgPaths.length === 0) return { success: false };

    // Step 3: FFmpeg slideshow
    const outPath    = path.join(TMP, `lumeo_video_${ts}.mp4`);
    const inputLines = imgPaths.map(p => `file '${p}'\nduration 3`).join("\n") + `\nfile '${imgPaths[imgPaths.length - 1]}'`;
    const listPath   = path.join(TMP, `lumeo_vid_list_${ts}.txt`);
    fs.writeFileSync(listPath, inputLines);

    await new Promise((resolve, reject) => {
      const cmd = `ffmpeg -f concat -safe 0 -i "${listPath}" -vf "scale=720:480:force_original_aspect_ratio=decrease,pad=720:480:(ow-iw)/2:(oh-ih)/2:color=black,fps=24" -c:v libx264 -pix_fmt yuv420p -crf 28 -y "${outPath}" 2>&1`;
      exec(cmd, { timeout: 120000 }, (err, stdout) => {
        if (err) { console.error("[Video] FFmpeg error:", err.message.slice(0, 100)); reject(err); }
        else { console.log("[Video] ✅ FFmpeg done"); resolve(); }
      });
    });

    if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 1000) return { success: false };

    const buffer = fs.readFileSync(outPath);
    console.log(`[Video] ✅ ${(buffer.length / 1024 / 1024).toFixed(1)}MB video ready`);

    return {
      success: true, buffer,
      cleanup: () => { [outPath, listPath, ...imgPaths].forEach(f => { try { fs.unlinkSync(f); } catch {} }); },
    };
  } catch (e) {
    console.error("[Video] Error:", e.message);
    return { success: false };
  }
}

module.exports = { generateVideo };
