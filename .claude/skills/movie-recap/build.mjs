// Usage: node build.mjs <workdir>
// Reads script.json + meta.json + cuts.txt, voices each beat through the running dev server
// (/api/v2/tts-preview, cached by text), fits clips to each beat, cuts them out of the source into
// footage.mp4 (so Remotion never touches the full movie), writes narration.wav + props.json.
import fs from "fs";
import { execFileSync } from "child_process";
import path from "path";
import crypto from "crypto";

export const MAX_CLIP = 3;
const FPS = 30;
const PAUSE_MS = 300;
const TAIL_MS = 1000;
const TTS_URL = "http://localhost:3000/api/v2/tts-preview";

// Take clips in order until they cover `need` seconds, then shrink them all evenly to land exactly on it.
export function fit(clips, need) {
  const used = [];
  let sum = 0;
  for (const c of clips) {
    if (sum >= need) break;
    used.push(c);
    sum += c[1];
  }
  if (sum < need) return { short: need - sum };
  return { clips: used.map(([s, d]) => [s, (d * need) / sum]) };
}

// A clip crossing a hard cut keeps its longer side, so no clip ever shows two shots.
export function snap([s, d], cuts) {
  const c = cuts.find((c) => c > s + 0.1 && c < s + d - 0.1);
  if (c === undefined) return [s, d];
  return c - s >= s + d - c ? snap([s, c - s - 0.05], cuts) : snap([c + 0.05, s + d - c - 0.05], cuts);
}

function wavHeader(len, rate) {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + len, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(rate, 24);
  h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(len, 40);
  return h;
}

async function voice(dir, { model, voice: v }, text) {
  const file = path.join(dir, "tts", crypto.createHash("sha1").update(JSON.stringify([model, v, text])).digest("hex") + ".wav");
  if (!fs.existsSync(file)) {
    const r = await fetch(TTS_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, voice: v, text }) });
    const j = await r.json();
    if (!r.ok || !j.audio) throw new Error(`TTS failed for "${text.slice(0, 40)}": ${JSON.stringify(j).slice(0, 300)}`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, Buffer.from(j.audio, "base64"));
  }
  const wav = fs.readFileSync(file);
  return { rate: wav.readUInt32LE(24), pcm: wav.subarray(44) };
}

async function build(dir) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8"));
  const script = JSON.parse(fs.readFileSync(path.join(dir, "script.json"), "utf8"));
  const cuts = fs.readFileSync(path.join(dir, "cuts.txt"), "utf8").split("\n").filter(Boolean).map(Number);
  const tts = { model: script.model || "google/gemini-3.8-flash-tts", voice: script.voice || "Zephyr" };
  const errors = [];
  const warnings = [];

  script.beats.forEach((b, i) => b.clips.forEach(([s, d]) => {
    if (!(d > 0 && d <= MAX_CLIP)) errors.push(`beat ${i + 1}: clip @${s} is ${d}s (max ${MAX_CLIP}s)`);
    if (s < 0 || s + d > meta.duration) errors.push(`beat ${i + 1}: clip @${s} +${d}s is outside the video (0-${meta.duration}s)`);
  }));
  if (errors.length) throw new Error(errors.join("\n"));
  script.beats.forEach((b, i) => {
    b.clips = b.clips.map((c) => snap(c, cuts)).filter(([s, d]) => {
      if (d >= 0.8) return true;
      warnings.push(`beat ${i + 1}: dropped clip @${s}, only ${d.toFixed(2)}s between cuts`);
    });
  });

  const voiced = [];
  for (const [i, b] of script.beats.entries()) {
    process.stdout.write(`voicing beat ${i + 1}/${script.beats.length}\r`);
    voiced.push(await voice(dir, tts, b.text));
  }
  process.stdout.write("\n");
  const rate = voiced[0].rate;
  if (voiced.some((v) => v.rate !== rate)) throw new Error("Beats came back at different sample rates; voice all with one model");
  const silence = (ms) => Buffer.alloc(Math.round((ms * rate) / 1000) * 2);

  const parts = [];
  const clips = [];
  let at = 0;
  script.beats.forEach((b, i) => {
    const ms = (voiced[i].pcm.length / 2 / rate) * 1000 + (i === script.beats.length - 1 ? TAIL_MS : PAUSE_MS);
    parts.push(voiced[i].pcm, silence(ms - (voiced[i].pcm.length / 2 / rate) * 1000));
    const f = fit(b.clips, ms / 1000);
    if (f.short) return errors.push(`beat ${i + 1}: needs ${(ms / 1000).toFixed(1)}s, clips are ${f.short.toFixed(1)}s short — add clips`);
    for (const [s, d] of f.clips) {
      if (d < 1) warnings.push(`beat ${i + 1}: clip @${s} shrank to ${d.toFixed(2)}s`);
      const startFrame = Math.round(at * FPS);
      at += d;
      clips.push({ from: s, frames: Math.round(at * FPS) - startFrame });
    }
  });
  if (errors.length) throw new Error(errors.join("\n"));

  // Exact frame counts per clip keep the footage in sync with the narration timeline.
  const tmp = path.join(dir, "clips");
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp);
  clips.forEach((c, i) => {
    process.stdout.write(`cutting clip ${i + 1}/${clips.length}\r`);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(c.from), "-i", meta.source, "-an", "-sn",
      "-vf", `fps=${FPS},scale=1920:-2,setsar=1`, "-frames:v", String(c.frames),
      "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-pix_fmt", "yuv420p", path.join(tmp, `${i}.mp4`)]);
  });
  process.stdout.write("\n");
  fs.writeFileSync(path.join(tmp, "list.txt"), clips.map((_, i) => `file '${i}.mp4'`).join("\n"));
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-i", path.join(tmp, "list.txt"), "-c", "copy", path.join(dir, "footage.mp4")]);
  fs.rmSync(tmp, { recursive: true, force: true });

  const pcm = Buffer.concat(parts);
  fs.writeFileSync(path.join(dir, "narration.wav"), Buffer.concat([wavHeader(pcm.length, rate), pcm]));
  const vertical = script.format === "9:16";
  const durationMs = Math.round(at * 1000);
  fs.writeFileSync(path.join(dir, "props.json"), JSON.stringify({
    fps: FPS, width: vertical ? 1080 : 1920, height: vertical ? 1920 : 1080, vertical, durationMs,
    audioSrc: "narration.wav", videoSrc: "footage.mp4",
  }, null, 2));

  const pct = (durationMs / 10 / meta.duration).toFixed(1);
  warnings.forEach((w) => console.warn("warn:", w));
  if (pct < 5 || pct > 10) console.warn(`warn: recap is ${pct}% of the source (target 5-10%)`);
  console.log(`ok: ${(durationMs / 1000).toFixed(1)}s recap (${pct}% of ${Math.round(meta.duration)}s), ${clips.length} clips, longest ${(Math.max(...clips.map((c) => c.frames)) / FPS).toFixed(2)}s`);
}

if (process.argv[2] === "--test") {
  const assert = (await import("assert")).strict;
  assert.deepEqual(fit([[0, 3], [10, 3], [20, 3]], 4.5), { clips: [[0, 2.25], [10, 2.25]] });
  assert.deepEqual(fit([[0, 2]], 3), { short: 1 });
  assert.deepEqual(snap([10, 3], [12]), [10, 1.95]);
  assert.deepEqual(snap([10, 3], [10.5]), [10.55, 2.45]);
  assert.deepEqual(snap([10, 3], [20]), [10, 3]);
  console.log("build ok");
} else {
  await build(process.argv[2]);
}
