// Story v2: scene-first pipeline. The LLM writes the script as scenes; each scene is
// voiced as one TTS clip and split into shots (one image each, a few seconds long).
// script.json -> per-scene TTS -> assemble audio + per-shot timings.json -> one ComfyUI
// image per shot -> Remotion. Each character gets one reference "sheet" image; shots that
// show characters are drawn with the Klein edit workflow using those sheets, so they stay on-model. No subtitles / ASR. All work runs as a server-side job per
// project; the pages (public/story2*.html) only start jobs and poll state.
import path from "path";
import fs from "fs";
import { promises as fsp } from "fs";
import { execFile } from "child_process";
import { promisify } from "util";
import { generateText } from "ai";
import { getStorageRoot } from "./scripts/remotion-data.js";

// Measured with Fish Drama 3 on Hindi narration, pauses included.
const WORDS_PER_SECOND = 2.2;

function scriptPrompt(secondsPerImage) {
  const w = Math.max(4, Math.round(secondsPerImage * WORDS_PER_SECOND));
  return `You write short, funny, warm stories for YouTube Shorts for kids aged 3-7 and their parents in North India.

Language: modern conversational North Indian Hindi (UP/Bihar style), in Devanagari. Simple everyday words a 4-year-old understands. No formal or literary Hindi. Fun sound words (like "धड़ाम!", "चपाक!", "खी-खी-खी") only where they fit.

Story arc (about 130-160 Hindi words total, ~55 seconds read aloud):
1. Hook: one punchy line that makes a kid stop scrolling (a surprise, a question, or "अरे सुनो सुनो!").
2. Who the hero is and what they want.
3. The problem.
4. A genuinely funny moment.
5. The twist.
6. How it ends.
7. A one-line moral at the end, said warmly, not preachy.

Split the story into 5-8 scenes. A scene is one continuous beat, voiced as one audio clip (1-3 short sentences), with one "emotion": excited, happy, curious, surprised, whispering, sad, scared, laughing or calm.

Each scene is split into shots. Each shot shows one image for about ${secondsPerImage} seconds, so each shot's "text" is about ${w} Hindi words (never more than ${w + 4}). Split at natural phrase boundaries. The shot texts of a scene, in order, ARE that scene's narration. Dialogue is allowed. No SSML, no stage directions, no emojis, no English words unless kids commonly say them.

Each shot's "image" is an English image prompt for exactly what its text says. Write it in this order: the action, the characters, the place, the framing (close-up / medium / wide, angle). Rules:
- Only actions a single still image can show (a pose, an expression, a moment), never motion over time like "spinning in circles" or "keeps running".
- At most 2 characters per shot.
- Consecutive shots must look different: change the place, the action, the framing or the angle. Do not use the same place for more than 2 shots in a row.
- Refer to characters and places ONLY by placeholders like $hero, $forest. Never describe art style (it is added later). No text, signs or letters in the image.

"characters" maps each character placeholder (people, animals, talking objects) to a precise English description an illustrator could redraw identically every time: body shape and silhouette, size, the exact color of each part, clothes or accessories, and 2-3 unique distinguishing features. Every character must look clearly different from the others in shape and silhouette, not only in color. One placeholder = one fixed look; if a character's look changes during the story, make a separate placeholder for each look (e.g. $jackal and $jackal_blue).

"places" maps each place placeholder to an English description: location, key objects, lighting, time of day.

Output ONLY this JSON, nothing else:
{
  "title": "Hindi title",
  "characters": { "$placeholder": "description" },
  "places": { "$placeholder": "description" },
  "scenes": [ { "emotion": "excited", "shots": [ { "text": "Hindi part of the narration", "image": "English prompt using $placeholders" } ] } ]
}`;
}

function reviewPrompt(secondsPerImage) {
  const w = Math.max(4, Math.round(secondsPerImage * WORDS_PER_SECOND));
  return `You are a strict editor of kids' YouTube Shorts scripts in Hindi. You get a script JSON.
Check and fix: is the hook strong in the first line; are words simple enough for a 4-year-old; does it flow with rhythm when read aloud; is there a real funny moment; is the moral clear and short; is total narration about 130-160 words; is every shot's text about ${w} words (split longer shots into more shots, each with its own image); does every image prompt match its shot text and show only a still moment; does any shot have more than 2 characters; do consecutive shots vary place, framing or angle; is every $placeholder used defined in characters or places; does each character have a precise shape-and-color description and look clearly different from the others in silhouette; does each placeholder have only one look.
Fix every problem you find. Keep what already works.
Output ONLY the full improved JSON in exactly the same schema, nothing else.`;
}

const IMAGE_STYLE =
  "bright Indian children's book illustration style, rounded shapes, cheerful vibrant palette, warm sunlight, portrait 9:16, no text in image, safe for ages 3-7";

const SAFE_ID = /^[\w-]+$/;

// Older scripts: { narration, image } per scene, and one "entities" map (kept as places: no sheets).
function normalize(script) {
  if (!Array.isArray(script.scenes) || !script.scenes.length) throw new Error("Script JSON has no scenes");
  script.characters ||= {};
  script.places ||= {};
  for (const [k, v] of Object.entries(script.entities || {})) if (!(k in script.characters)) script.places[k] ??= v;
  delete script.entities;
  script.scenes = script.scenes.map(({ narration, image, ...sc }) => ({
    ...sc,
    shots: (sc.shots || [{ text: narration, image }]).map((sh) => ({ text: (sh.text || "").trim(), image: (sh.image || "").trim() })),
  }));
  if (!script.scenes.every((sc) => sc.shots.length && sc.shots.every((sh) => sh.text))) throw new Error("Every shot needs text");
  return script;
}

function parseJson(text) {
  return normalize(JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)));
}

const narrationOf = (scene) => scene.shots.map((sh) => sh.text).join(" ");
const imageName = (n, j) => `${n}-${j}.png`;
export const sheetName = (placeholder) => `char-${placeholder.replace(/[^\w-]/g, "")}.png`;
const randomSeed = () => Math.floor(Math.random() * 1e15);

// Character placeholders used in a prompt, in order of appearance ($jackal does not match inside $jackal_blue).
export function charactersIn(prompt, characters) {
  return Object.keys(characters)
    .map((k) => [k, prompt.search(new RegExp(`${k.replace(/[$]/g, "\\$")}(?![\\w])`))])
    .filter(([, at]) => at >= 0)
    .sort((a, b) => a[1] - b[1])
    .map(([k]) => k);
}

export function resolvePlaceholders(prompt, entities) {
  // Longest first so $jackal never eats the start of $jackal_blue.
  const keys = Object.keys(entities).sort((a, b) => b.length - a.length);
  return keys.reduce((p, k) => p.split(k).join(entities[k]), prompt);
}

export function emotionTag(model, emotion, enabled) {
  if (!enabled || !emotion) return "";
  if (model.startsWith("fish-audio/")) return `(${emotion}) `;
  if (model.startsWith("google/")) return `[${emotion}] `;
  return "";
}

// Split one scene's clip across its shots by text length.
// ponytail: char-proportional, not word-aligned; off by a few hundred ms at most. Use ASR word timestamps if that shows.
export function shotTimings(startMs, clipMs, endMs, shots) {
  const lens = shots.map((sh) => sh.text.length);
  const total = lens.reduce((a, b) => a + b, 0);
  let acc = 0;
  return shots.map((_, j) => {
    const s = startMs + Math.round((clipMs * acc) / total);
    acc += lens[j];
    return { startMs: s, endMs: j === shots.length - 1 ? endMs : startMs + Math.round((clipMs * acc) / total) };
  });
}

async function speak({ model, voice, text }) {
  const key = process.env.OPENROUTER_TTS_API_KEY || process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("OPENROUTER_API_KEY not configured");
  const r = await fetch("https://openrouter.ai/api/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model, input: text, ...(voice ? { voice } : {}) }),
  });
  if (!r.ok) throw new Error(`TTS ${model} (${r.status}): ${await r.text()}`);
  const type = r.headers.get("content-type") || "";
  // ponytail: every OpenRouter speech model tested returns audio/pcm;rate=N (16-bit mono); add ffmpeg decode if one returns mp3.
  const rate = Number(/audio\/pcm;\s*rate=(\d+)/.exec(type)?.[1]);
  if (!rate) throw new Error(`TTS ${model}: unsupported audio type '${type}'`);
  return { pcm: Buffer.from(await r.arrayBuffer()), rate };
}

export function registerStory2(app, { openrouter, getProjectDir, getComfyClient, comfyUrl, comfyWorkflow, comfyEditWorkflow, buildWavHeader, createStoryVideoRemotion, defaultModel }) {
  // ponytail: jobs live in memory; a server restart drops a running job, and re-running skips finished work.
  const jobs = {};
  const projectsRoot = path.join(getStorageRoot(), "projects");
  const DEFAULTS_FILE = path.join(process.cwd(), "data", "story2-defaults.json");
  const SETTING_KEYS = ["input", "model", "review", "secondsPerImage", "tts", "pauseMs", "useSheets"];
  const pick = (o) => Object.fromEntries(SETTING_KEYS.filter((k) => o?.[k] !== undefined).map((k) => [k, o[k]]));

  const dirOf = (id) => {
    if (!SAFE_ID.test(id)) throw new Error("Invalid project id");
    return getProjectDir(id);
  };
  const readScript = async (dir) => normalize(JSON.parse(await fsp.readFile(path.join(dir, "script.json"), "utf8")));
  const saveScript = (dir, script) => fsp.writeFile(path.join(dir, "script.json"), JSON.stringify(script, null, 2));
  const readMeta = (f) => fsp.readFile(f, "utf8").then(JSON.parse, () => null);
  // Project settings are saved per project; everything but the idea also becomes the default for new projects.
  async function saveSettings(dir, body) {
    const settings = { ...(await readMeta(path.join(dir, "settings.json"))), ...pick(body) };
    await fsp.writeFile(path.join(dir, "settings.json"), JSON.stringify(settings, null, 2));
    const { input, ...defaults } = settings;
    await fsp.writeFile(DEFAULTS_FILE, JSON.stringify(defaults, null, 2));
    return settings;
  }

  // Job state is mirrored to job.json so a server restart shows up as "interrupted" instead of vanishing.
  async function jobOf(id, dir) {
    if (jobs[id]) return jobs[id];
    const saved = await readMeta(path.join(dir, "job.json"));
    if (!saved?.running) return saved;
    return { ...saved, running: false, current: null, error: "Interrupted by a server restart", label: "Interrupted by a server restart. Click the same button again to resume; finished work is skipped." };
  }

  const wav = (pcm, rate) => Buffer.concat([buildWavHeader(pcm.length, rate), pcm]);
  const route = (fn) => async (req, res) => {
    try {
      res.json({ success: true, ...(await fn(req)) });
    } catch (e) {
      console.error("[story2]", e.message);
      res.status(e.status || 500).json({ success: false, error: e.message });
    }
  };

  async function writeScript(dir, { input, model, review = true, secondsPerImage = 4 }) {
    if (!input) throw new Error("Story idea is required");
    const llm = openrouter.chat(model || defaultModel);
    const draft = await generateText({ model: llm, system: scriptPrompt(secondsPerImage), prompt: input });
    let script = parseJson(draft.text);
    if (review) {
      const fixed = await generateText({ model: llm, system: reviewPrompt(secondsPerImage), prompt: JSON.stringify(script) });
      script = parseJson(fixed.text);
    }
    await saveScript(dir, { ...script, input, model: model || defaultModel });
  }

  // Skips the scene when its audio was made from the same text + voice settings.
  async function voiceScene(dir, scene, n, { model, voice, tags }, force) {
    const narration = narrationOf(scene);
    const key = JSON.stringify({ model, voice, tags, narration, emotion: scene.emotion });
    const file = path.join(dir, `scene-${n}.wav`);
    if (!force && fs.existsSync(file) && (await readMeta(`${file}.json`))?.key === key) return false;
    const { pcm, rate } = await speak({ model, voice, text: emotionTag(model, scene.emotion, tags) + narration });
    await fsp.writeFile(file, wav(pcm, rate));
    await fsp.writeFile(`${file}.json`, JSON.stringify({ key }));
    return true;
  }

  // Join scene clips with a pause; shot timings fall out of clip lengths + shot text lengths.
  async function assemble(dir, scenes, pauseMs = 300) {
    const clips = await Promise.all(scenes.map((_, i) => fsp.readFile(path.join(dir, `scene-${i + 1}.wav`))));
    const rate = clips[0].readUInt32LE(24);
    if (clips.some((c) => c.readUInt32LE(24) !== rate)) throw new Error("Scene clips use different sample rates; voice all scenes with one model");
    const bytesPerMs = (rate * 2) / 1000;
    const silence = (ms) => Buffer.alloc(Math.round(ms * bytesPerMs) & ~1);
    const parts = [];
    const timings = [];
    let at = 0;
    clips.forEach((c, i) => {
      const pcm = Buffer.concat([c.subarray(44), silence(i === clips.length - 1 ? 1000 : pauseMs)]);
      const startMs = Math.round(at / bytesPerMs);
      const shots = shotTimings(startMs, (c.length - 44) / bytesPerMs, Math.round((at + pcm.length) / bytesPerMs), scenes[i].shots);
      shots.forEach((t, j) => timings.push({ ...t, image: imageName(i + 1, j + 1) }));
      parts.push(pcm);
      at += pcm.length;
    });
    await fsp.writeFile(path.join(dir, "audio.wav"), wav(Buffer.concat(parts), rate));
    await fsp.writeFile(path.join(dir, "timings.json"), JSON.stringify(timings, null, 2));
  }

  // One ComfyUI generation -> PNG file (+ .json meta with the key it was made from).
  async function comfyImage(file, key, inputs, workflow) {
    const client = await getComfyClient();
    if (!client) throw new Error("COMFY_URL not configured");
    const result = await client.generateImage({
      workflow,
      inputs: { width: 512, height: 922, seed: randomSeed(), ...inputs },
      output: { type: "base64" },
    });
    const b64 = result.images?.[0]?.base64?.split(",")[1];
    if (!b64) throw new Error("No image in ComfyUI response");
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, b64, "base64");
    await fsp.writeFile(`${file}.json`, JSON.stringify({ key }));
  }
  const isFresh = async (file, key) => fs.existsSync(file) && (await readMeta(`${file}.json`))?.key === key;

  // hmd-comfy-client's own upload (form-data package + native fetch) gets a 500 from ComfyUI; native FormData works.
  async function uploadToComfy(file, name) {
    const fd = new FormData();
    fd.append("image", new Blob([await fsp.readFile(file)], { type: "image/png" }), name);
    fd.append("overwrite", "true");
    const r = await fetch(`${comfyUrl}/upload/image`, { method: "POST", body: fd });
    if (!r.ok) throw new Error(`ComfyUI upload failed (${r.status})`);
    return (await r.json()).name;
  }

  // Character reference sheet: the character alone on plain white, used as the edit reference.
  async function sheetImage(dir, placeholder, description, force) {
    const prompt = `Character reference sheet: ${description}. A single character, full body, front three-quarter view, centered, plain white background, nothing else in the image, ${IMAGE_STYLE}`;
    const file = path.join(dir, "images", sheetName(placeholder));
    if (!force && (await isFresh(file, prompt))) return;
    await comfyImage(file, prompt, { prompt }, comfyWorkflow);
  }

  // Skips the shot when its image was made from the same prompt + the same character sheets.
  async function imageShot(id, dir, script, n, j, force, useSheets) {
    const raw = script.scenes[n - 1].shots[j - 1].image;
    const entities = { ...script.places, ...script.characters };
    const chars = useSheets ? charactersIn(raw, script.characters).slice(0, 3) : [];
    const sheets = chars.map((c) => path.join(dir, "images", sheetName(c)));
    const scene = `${resolvePlaceholders(raw, entities)}, ${IMAGE_STYLE}`;
    const prompt = chars.length
      ? `The ${chars.length > 1 ? `characters from image 1 (left to right: ${chars.map((c) => c.slice(1)).join(", ")})` : "character from image 1"}, exactly the same design and colors. ${scene}`
      : scene;
    const key = JSON.stringify({ prompt, sheets: sheets.map((f) => Math.round(fs.statSync(f).mtimeMs)) });
    const file = path.join(dir, "images", imageName(n, j));
    if (!force && (await isFresh(file, key))) return;
    if (!chars.length) return comfyImage(file, key, { prompt }, comfyWorkflow);
    // Several characters: put their sheets side by side into one reference image.
    let ref = sheets[0];
    if (sheets.length > 1) {
      ref = path.join(dir, "images", `ref-${n}-${j}.png`);
      await promisify(execFile)("ffmpeg", ["-y", "-v", "error", ...sheets.flatMap((f) => ["-i", f]), "-filter_complex", `hstack=inputs=${sheets.length}`, ref]);
    }
    const reference = await uploadToComfy(ref, `${id}-ref-${n}-${j}.png`);
    await comfyImage(file, key, { prompt, reference }, comfyEditWorkflow);
  }

  // opts: { steps: ["script","voice","images","video"], scene?: n, shot?: j (only that scene/shot, forced),
  //         force?: redo unchanged too, keepScript?: skip script step if written from the same idea, input, model, review, secondsPerImage, tts, pauseMs }
  async function runJob(id, opts) {
    const job = (jobs[id] = { running: true, label: "Starting", steps: opts.steps, scene: opts.scene || null, error: null, startedAt: Date.now() });
    const jobFile = path.join(getStorageRoot(), "projects", id, "job.json");
    const set = (label) => {
      job.label = label;
      console.log(`[story2] ${id}: ${label}`);
      try { fs.writeFileSync(jobFile, JSON.stringify(job)); } catch {}
    };
    try {
      const dir = await dirOf(id);
      const steps = new Set(opts.steps);
      const force = !!(opts.scene || opts.force);
      // keepScript (Generate everything): reuse the script if it was written from this same idea.
      const existing = await readMeta(path.join(dir, "script.json"));
      if (steps.has("script") && !(opts.keepScript && existing?.input === opts.input)) {
        set("Writing script (can take a minute)");
        await writeScript(dir, opts);
      }
      const script = await readScript(dir);
      const total = script.scenes.length;
      const ns = opts.scene ? [opts.scene] : script.scenes.map((_, i) => i + 1);
      if (ns.some((n) => !script.scenes[n - 1])) throw new Error("No such scene");

      if (steps.has("voice")) {
        if (!opts.tts?.model) throw new Error("TTS model is required");
        for (const n of ns) {
          set(`Voicing scene ${n}/${total} (${opts.tts.model})`);
          job.current = { kind: "voice", n };
          set(job.label);
          await voiceScene(dir, script.scenes[n - 1], n, opts.tts, force);
        }
        job.current = null;
        if (script.scenes.every((_, i) => fs.existsSync(path.join(dir, `scene-${i + 1}.wav`)))) {
          set("Joining audio");
          await assemble(dir, script.scenes, opts.pauseMs);
        }
      }
      const useSheets = opts.useSheets !== false;
      // Sheets: made before images (only missing/changed ones), or one redone via opts.character.
      if (steps.has("sheets") || (steps.has("images") && useSheets)) {
        const chars = opts.character ? [opts.character] : Object.keys(script.characters);
        for (const c of chars) {
          if (!script.characters[c]) throw new Error(`No character ${c}`);
          set(`Character sheet ${c}`);
          job.current = { kind: "sheet", character: c };
          set(job.label);
          await sheetImage(dir, c, script.characters[c], !!opts.character || (steps.has("sheets") && !!opts.force));
        }
        job.current = null;
      }
      if (steps.has("images")) {
        const shots = ns.flatMap((n) => script.scenes[n - 1].shots.map((_, j) => [n, j + 1]))
          .filter(([, j]) => !opts.shot || j === opts.shot);
        for (const [k, [n, j]] of shots.entries()) {
          set(`Image ${k + 1}/${shots.length} (scene ${n}, shot ${j}) on ComfyUI`);
          job.current = { kind: "image", n, shot: j };
          set(job.label);
          await imageShot(id, dir, script, n, j, force, useSheets);
        }
        job.current = null;
      }
      if (steps.has("video")) {
        if (!fs.existsSync(path.join(dir, "timings.json"))) throw new Error("Voice all scenes first");
        const missing = script.scenes.flatMap((sc, i) => sc.shots.map((_, j) => imageName(i + 1, j + 1)))
          .filter((f) => !fs.existsSync(path.join(dir, "images", f)));
        if (missing.length) throw new Error(`Missing images: ${missing.join(", ")}`);
        set("Rendering video (a minute or two)");
        await createStoryVideoRemotion(id, () => {});
      }
      set("Done");
    } catch (e) {
      job.error = e.message;
      set(`Failed: ${e.message}`);
    } finally {
      job.running = false;
      job.current = null;
      job.finishedAt = Date.now();
      set(job.label);
    }
  }

  const busy = (id, onlyScript) => {
    const j = jobs[id];
    if (j?.running && (!onlyScript || j.steps.includes("script"))) throw Object.assign(new Error(`Busy: ${j.label}`), { status: 409 });
  };

  app.post("/api/v2/project/:id/run", route(async (req) => {
    const dir = await dirOf(req.params.id);
    busy(req.params.id);
    const opts = req.body || {};
    if (!Array.isArray(opts.steps) || !opts.steps.length) throw new Error("steps is required");
    await saveSettings(dir, opts);
    runJob(req.params.id, opts); // background: the response returns right away
    return { job: jobs[req.params.id] };
  }));

  // Edits may be saved while voice/image jobs run (they read the script once at start);
  // changed scenes simply count as stale next run. Not while a script is being written.
  app.put("/api/v2/project/:id/script", route(async (req) => {
    const dir = await dirOf(req.params.id);
    busy(req.params.id, true);
    await saveScript(dir, normalize(req.body.script));
    return { scriptMtime: Math.round(fs.statSync(path.join(dir, "script.json")).mtimeMs) };
  }));

  app.put("/api/v2/project/:id/settings", route(async (req) => ({ settings: await saveSettings(await dirOf(req.params.id), req.body) })));

  // New project with the source's idea + settings, created on the server.
  app.post("/api/v2/project/:id/clone", route(async (req) => {
    const src = await dirOf(req.params.id);
    const settings = (await readMeta(path.join(src, "settings.json"))) || {};
    const input = settings.input || (await readMeta(path.join(src, "script.json")))?.input || "";
    const base = `s2-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}`;
    let id = base;
    for (let k = 2; fs.existsSync(path.join(projectsRoot, id)); k++) id = `${base}-${k}`;
    await saveSettings(await dirOf(id), { ...settings, input });
    return { id };
  }));

  // v2 projects = folders with a settings.json or script.json.
  app.get("/api/v2/projects", route(async () => {
    const ids = (await fsp.readdir(projectsRoot, { withFileTypes: true }).catch(() => []))
      .filter((d) => d.isDirectory() && SAFE_ID.test(d.name)).map((d) => d.name);
    const projects = [];
    for (const id of ids) {
      const dir = path.join(projectsRoot, id);
      const settings = await readMeta(path.join(dir, "settings.json"));
      const script = await readMeta(path.join(dir, "script.json"));
      if (!settings && !script) continue;
      const mt = (f) => Math.round(fs.statSync(path.join(dir, f), { throwIfNoEntry: false })?.mtimeMs || 0);
      const job = await jobOf(id, dir);
      projects.push({
        id,
        title: script?.title || "",
        input: script?.input || settings?.input || "",
        scenes: script?.scenes?.length || 0,
        audio: !!mt("timings.json"),
        video: !!mt("video.mp4"),
        updatedAt: Math.max(mt("settings.json"), mt("script.json"), mt("audio.wav"), mt("video.mp4")),
        job: job ? { running: job.running, label: job.label, error: job.error } : null,
      });
    }
    projects.sort((a, b) => b.updatedAt - a.updatedAt);
    return { projects };
  }));

  // File mtimes (0 = missing) let the page refresh only what changed.
  app.get("/api/v2/project/:id", route(async (req) => {
    const dir = await dirOf(req.params.id);
    const mt = (f) => Math.round(fs.statSync(path.join(dir, f), { throwIfNoEntry: false })?.mtimeMs || 0);
    let script = null;
    try { script = await readScript(dir); } catch {}
    return {
      script,
      scriptMtime: mt("script.json"),
      sceneAudio: (script?.scenes || []).map((_, i) => mt(`scene-${i + 1}.wav`)),
      shotImages: (script?.scenes || []).map((sc, i) => sc.shots.map((_, j) => mt(`images/${imageName(i + 1, j + 1)}`))),
      sheets: Object.fromEntries(Object.keys(script?.characters || {}).map((c) => [c, mt(`images/${sheetName(c)}`)])),
      audio: mt("timings.json") && mt("audio.wav"),
      video: mt("video.mp4"),
      job: await jobOf(req.params.id, dir),
      settings: (await readMeta(path.join(dir, "settings.json"))) || (await readMeta(DEFAULTS_FILE)),
    };
  }));

  app.get("/api/v2/project/:id/file/:name", async (req, res) => {
    if (!SAFE_ID.test(req.params.id) || !/^[\w-]+\.(wav|mp4)$/.test(req.params.name)) return res.status(400).end();
    res.sendFile(path.join(await getProjectDir(req.params.id), req.params.name), (e) => e && res.status(404).end());
  });

  // Quick A/B of TTS models: nothing is saved.
  app.post("/api/v2/tts-preview", route(async (req) => {
    const { model, voice, text, emotion, tags } = req.body;
    const { pcm, rate } = await speak({ model, voice, text: emotionTag(model, emotion, tags) + text });
    return { audio: wav(pcm, rate).toString("base64"), durationMs: Math.round((pcm.length / 2 / rate) * 1000) };
  }));
}

// Self-check: node story2.js
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const assert = (await import("assert")).strict;
  assert.equal(resolvePlaceholders("$jackal meets $jackal_blue", { $jackal: "A", $jackal_blue: "B" }), "A meets B");
  assert.deepEqual(charactersIn("$jackal_blue waves at $lion near $jackal_blue_den", { $jackal: "", $jackal_blue: "", $lion: "", $bear: "" }), ["$jackal_blue", "$lion"]);
  assert.equal(sheetName("$jackal_blue"), "char-jackal_blue.png");
  const legacy = normalize({ entities: { $a: "x" }, scenes: [{ shots: [{ text: "t" }] }] });
  assert.deepEqual([legacy.places, legacy.characters, legacy.entities], [{ $a: "x" }, {}, undefined]);
  assert.equal(emotionTag("fish-audio/drama-3", "excited", true), "(excited) ");
  assert.equal(emotionTag("google/gemini-3.8-flash-tts", "sad", true), "[sad] ");
  assert.equal(emotionTag("hexgrad/kokoro-82m", "sad", true), "");
  assert.equal(parseJson('```json\n{"scenes":[{"shots":[{"text":"x","image":"y"}]}]}\n```').scenes.length, 1);
  assert.deepEqual(normalize({ scenes: [{ narration: "a", image: "b", emotion: "sad" }] }).scenes[0], { emotion: "sad", shots: [{ text: "a", image: "b" }] });
  assert.deepEqual(shotTimings(1000, 9000, 10300, [{ text: "x".repeat(40) }, { text: "y".repeat(60) }]),
    [{ startMs: 1000, endMs: 4600 }, { startMs: 4600, endMs: 10300 }]);
  console.log("story2 ok");
}
