import "dotenv/config";
import express from "express";
import path from "path";
import fs from "fs";
import { promises as fsPromises } from "fs";
import os from "os";
import { spawn } from "child_process";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { SarvamAIClient } from "sarvamai";
import OpenAI from "openai";
import { fileURLToPath } from "url";
import https from "https";
import ffmpeg from "fluent-ffmpeg";
import { prepareRemotionProject } from "./scripts/remotion-data.js";

ffmpeg.setFfmpegPath("/usr/bin/ffmpeg");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const STORAGE_ROOT = path.resolve(process.env.STORAGE_ROOT_DIR || "./storage");
const COMFY_URL = process.env.COMFY_URL || "";
const COMFY_WORKFLOW =
  process.env.COMFY_WORKFLOW ||
  "/media/hyper8/HYPER/Downloads/comfy-workflows/flux-kelin-gguf2.api.json";
const OPENROUTER_IMAGE_MODEL =
  process.env.OPENROUTER_IMAGE_MODEL || "black-forest-labs/flux.2-klein-4b";
const IMAGE_WIDTH = 810;
const IMAGE_HEIGHT = 1440;
const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY || "";
const RUNPOD_ENDPOINT = process.env.RUNPOD_ENDPOINT || "https://api.runpod.ai/v2/2ohcl4mmhwo9qt";
const COLAB_WHISPER_URL = process.env.COLAB_WHISPER_URL || "";

const AVAILABLE_MODELS = (process.env.AVAILABLE_MODELS || "")
  .split(",")
  .filter((m) => m.trim());
const DEFAULT_MODEL = AVAILABLE_MODELS[0] || "";

const openrouter = createOpenAI({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: process.env.OPENROUTER_BASE_URL || "https://opencode.ai/zen/v1",
});

const sarvamClient = process.env.SARVAM_API_KEY
  ? new SarvamAIClient({ apiSubscriptionKey: process.env.SARVAM_API_KEY })
  : null;

const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

let comfyClient = null;

async function getComfyClient() {
  if (!comfyClient && COMFY_URL) {
    console.log("Initializing ComfyClient with URL:", COMFY_URL);
    const { ComfyClient } = await import("hmd-comfy-client");
    comfyClient = new ComfyClient(COMFY_URL);
  }
  return comfyClient;
}

async function downloadWithRetry(client, imageInfo, outputPath, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await client.downloadImage(imageInfo, outputPath);
    } catch (err) {
      console.log(`Download attempt ${attempt} failed: ${err.message}`);
      if (attempt === retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

const SYSTEM_PROMPT_SSML = `You are an expert dialogue and narration writer for text-to-speech, specializing in playful, short-form storytelling for children aged 3–7 and their parents. When a story is provided, you understand its tone, rhythm, and emotions, then write lively, engaging, and easy-to-follow narration and dialogue in modern North Indian Hindi — natural for listeners from UP, Bihar, and nearby regions. Avoid formal or literary Hindi; keep it conversational, fun, and full of energy, crafted for YouTube Shorts so it instantly captures attention and keeps both kids and parents entertained. You can simplify, rephrase, or slightly adapt the story to make it short-worthy and engaging, while preserving the core meaning and emotion. Your output must be valid SSML compatible with Google Text-to-Speech, using natural yet energetic pacing, expressive pauses, prosody, and emphasis. Include natural, fitting sound expressions (like "खौं… खौं…", "गर्र…" or "ऊँ…") when they enhance storytelling — never forced. Maintain a bright, expressive tone with humor, warmth, and curiosity, ensuring the narration feels lively and shareable.

IMPORTANT OUTPUT RULES:
- Return only the exact words that should be spoken in TTS.
- Do not use screenplay or script labels such as "narration", "Narrator", "बच्चे", "गुरुजी", or speaker names before lines.
- Do not include stage directions, markdown, asterisks, brackets, emojis, or notes like "(excitedly)", "** narration **", or "[pause]".
- Do not explain tone separately; express tone only through the spoken wording and SSML.
- Output only the final speakable SSML, nothing else.`;

const SYSTEM_PROMPT_NO_SSML = `You are an expert dialogue and narration writer for text-to-speech, specializing in playful, short-form storytelling for children aged 3–7 and their parents. When a story is provided, you understand its tone, rhythm, and emotions, then write lively, engaging, and easy-to-follow narration and dialogue in modern North Indian Hindi — natural for listeners from UP, Bihar, and nearby regions. Avoid formal or literary Hindi; keep it conversational, fun, and full of energy, crafted for YouTube Shorts so it instantly captures attention and keeps both kids and parents entertained. You can simplify, rephrase, or slightly adapt the story to make it short-worthy and engaging, while preserving the core meaning and emotion. Do NOT use any SSML tags. Just return plain text with natural storytelling. Maintain a bright, expressive tone with humor, warmth, and curiosity, ensuring the narration feels lively and shareable.

IMPORTANT OUTPUT RULES:
- Return only the exact words that should be spoken in TTS.
- Do not use screenplay or script labels such as "narration", "Narrator", "बच्चे", "गुरुजी", or speaker names before lines.
- Do not include stage directions, markdown, asterisks, brackets, emojis, or notes like "(excitedly)", "** narration **", or "[pause]".
- Do not explain tone separately; express tone only through the spoken wording.
- Output only the final speakable plain text, nothing else.`;

const SYSTEM_PROMPT_YT = `You analyze a provided story or SRT and create YouTube Shorts metadata optimized for discoverability among North Indian Hindi-speaking kids and their parents. You produce 2-3 catchy, safe, kid-friendly title options mixing Hindi and English, a concise description, trending hashtags, and comma-separated tags. Always include relevant, high-performing hashtags in both the description and metadata that match the story's theme, moral, or festival context. You research current YouTube Shorts and Indian kids content trends to select high-performing Hindi and Hinglish keywords, festivals, morals, and curiosity hooks, while avoiding unsafe, scary, or inappropriate phrasing. You keep language simple, positive, culturally relevant, and appealing to parents. When details are missing, infer responsibly without altering the story's meaning. Be concise, SEO-aware, and platform-specific. Use Hindi-English mix (Hinglish) by default. Do not include policy-violating or misleading claims. Your goal is to make the reel reachable to the widest audience possible. Thumbnails are not included since YouTube Shorts auto-select them.

IMPORTANT: Return plain text, NOT JSON. Format the output as:

TITLES:
- Title 1
- Title 2
- Title 3

DESCRIPTION:
[Your description here]

HASHTAGS:
#tag1 #tag2 #tag3

TAGS:
tag1, tag2, tag3`;

const SYSTEM_PROMPT_IMAGE = `You are an expert screenplay writer and visual planner for children's stories.

Your job:

Convert SRT subtitles into image generation prompts using a placeholder system for consistency.

Output must be a valid JSON object with TWO keys:

1. "entities" - An object mapping placeholder names to their full descriptions
2. "prompts" - An array of prompt strings using those placeholders

ENTITY NAMING CONVENTION:
- Characters: $character1, $character2, $character3, etc.
- Scenes/Environments: $scene1, $scene2, $scene3, etc.
- Objects: $object1, $object2, $object3, etc.

ENTITY DEFINITION RULES:
- Each entity must be described ONCE with full detail
- Character entities must include: physical traits, clothing, age, distinguishing features
- Scene entities must include: location type, lighting, time of day, atmosphere, key elements
- Object entities must include: appearance, size, material, color
- Do NOT include style/format instructions in entities

PROMPT RULES:
- One prompt per subtitle index
- Never merge or skip subtitle numbers
- Each prompt must begin with: "Generate image X: ..."
- Use placeholders like $character1, $scene1 instead of full descriptions
- Prompts MUST include style/format at the end (these are NOT in entities)
- All prompts must be written in English

STYLE TO INCLUDE IN EACH PROMPT (not in entities):
- "bright Indian children's book illustration style"
- "portrait 9:16 format"
- "no text in image"
- "warm sunlight"
- "rounded shapes"
- "cheerful vibrant palette"
- "safe for ages 3-7"

EXAMPLE OUTPUT FORMAT:
{
  "entities": {
    "$character1": "a young Indian boy, age 6, short black hair, round face, big brown eyes, wearing bright red kurta and brown pants",
    "$character2": "an elderly Indian man, white beard, round glasses, kind wrinkled face, wearing white dhoti, holding wooden walking stick",
    "$scene1": "sunny North Indian village street, mud houses with thatched roofs, green rice paddies in background, warm golden morning light",
    "$scene2": "simple village home interior, clay walls, wooden charpoy cot in corner, soft natural window light, brass pot on floor"
  },
  "prompts": [
    "Generate image 1: $character1 walking happily through $scene1, bright Indian children's illustration, portrait 9:16, warm sunlight, no text",
    "Generate image 2: $character1 talking to $character2 inside $scene2, bright Indian children's illustration, portrait 9:16, warm sunlight, no text"
  ]
}

Do not explain anything.
Do not add commentary.
Only output the JSON object.`;

async function getProjectDir(projectId) {
  const dir = path.join(STORAGE_ROOT, "projects", projectId);
  await fsPromises.mkdir(dir, { recursive: true });
  return dir;
}

function loadTemplates() {
  try {
    const raw = fs.readFileSync(
      path.join(__dirname, "data", "templates.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const STORIES_FILE = path.join(__dirname, "data", "stories.json");
let storiesStore = [];
const storyProgress = {};

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function ensureStoryFields(stories) {
  const usedIds = new Set();
  for (const s of stories) {
    if (!s.id) {
      let base = slugify(s.title) || `story-${Date.now()}`;
      let id = base;
      let n = 2;
      while (usedIds.has(id)) id = `${base}-${n++}`;
      s.id = id;
    }
    usedIds.add(s.id);
    if (!s.status) s.status = "pending";
    if (!s.title) s.title = s.id;
  }
  return stories;
}

function loadStories() {
  try {
    const raw = fs.readFileSync(STORIES_FILE, "utf8");
    const parsed = JSON.parse(raw);
    storiesStore = Array.isArray(parsed) ? parsed : [];
  } catch {
    storiesStore = [];
  }
  ensureStoryFields(storiesStore);
  for (const s of storiesStore) {
    if (s.status === "generating") {
      s.status = "failed";
      s.error = "Interrupted (server restarted)";
    }
  }
  saveStories();
}

function saveStories() {
  try {
    fs.writeFileSync(STORIES_FILE, JSON.stringify(storiesStore, null, 2));
  } catch (err) {
    console.error("Failed to persist stories:", err.message);
  }
}

function getStory(id) {
  return storiesStore.find((s) => s.id === id) || null;
}

function updateStory(id, patch) {
  const s = getStory(id);
  if (!s) return null;
  Object.assign(s, patch);
  saveStories();
  return s;
}

function storyPublic(s) {
  if (!s) return null;
  const { title, about, id, status, templateId, projectId, error } = s;
  const out = { title, about, id, status, templateId, projectId, error };
  if (s.startedAt) out.startedAt = s.startedAt;
  if (s.completedAt) out.completedAt = s.completedAt;
  if (s.videoUrl) out.videoUrl = s.videoUrl;
  if (s.currentStep) out.currentStep = s.currentStep;
  const live = storyProgress[id];
  if (live) out.progress = live;
  return out;
}

loadStories();

const SCHEDULE_FILE = path.join(__dirname, "data", "schedule.json");
const SLOTS = [
  { key: "morning", hour: 8, minute: 0, label: "8:00 AM" },
  { key: "evening", hour: 19, minute: 0, label: "7:00 PM" },
];
let scheduleStore = {};

const AUTO_TEMPLATE_ID = process.env.AUTO_TEMPLATE_ID || "default-hindi-comfy";
const AUTO_GENERATION_ENABLED = process.env.AUTO_GENERATION_ENABLED !== "false";
const AUTO_POLL_INTERVAL_MS = 30 * 1000;

function formatDateYMD(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseYMD(ymd) {
  const [y, m, d] = String(ymd).split("-").map(Number);
  return new Date(y, m - 1, d);
}

function makeSlotId(date, slotKey) {
  const ymd = date instanceof Date ? formatDateYMD(date) : date;
  return `${ymd}-${slotKey}`;
}

function slotDetail(slotId) {
  const m = String(slotId).match(/^(\d{4}-\d{2}-\d{2})-(morning|evening)$/);
  if (!m) return null;
  const slot = SLOTS.find((s) => s.key === m[2]);
  return slot ? { ymd: m[1], key: m[2], slot } : null;
}

function loadSchedule() {
  try {
    const raw = fs.readFileSync(SCHEDULE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    scheduleStore =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : {};
  } catch {
    scheduleStore = {};
  }
}

function saveSchedule() {
  try {
    fs.writeFileSync(SCHEDULE_FILE, JSON.stringify(scheduleStore, null, 2));
  } catch (err) {
    console.error("Failed to persist schedule:", err.message);
  }
}

function isSlotBooked(slotId) {
  return !!scheduleStore[slotId];
}

function getSlotPublic(slotId) {
  return scheduleStore[slotId] || null;
}

function getNextAvailableSlots(count = 1, from = new Date()) {
  const result = [];
  const day = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  let guard = 0;
  while (result.length < count && guard < 400) {
    for (const slot of SLOTS) {
      const slotTime = new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate(),
        slot.hour,
        slot.minute,
      );
      if (slotTime.getTime() <= from.getTime()) continue;
      const slotId = makeSlotId(day, slot.key);
      if (isSlotBooked(slotId)) continue;
      result.push({
        slotId,
        date: formatDateYMD(day),
        slotKey: slot.key,
        label: slot.label,
        hour: slot.hour,
        minute: slot.minute,
        at: slotTime.toISOString(),
      });
      if (result.length >= count) break;
    }
    day.setDate(day.getDate() + 1);
    guard++;
  }
  return result;
}

function bookSlot(slotId, info = {}) {
  const detail = slotDetail(slotId);
  if (!detail) return { error: "Invalid slotId" };
  if (isSlotBooked(slotId))
    return { error: "Slot already booked", slot: getSlotPublic(slotId) };
  const entry = {
    slotId,
    date: detail.ymd,
    slotKey: detail.key,
    label: detail.slot.label,
    platform: info.platform || "youtube",
    projectId: info.projectId || null,
    storyId: info.storyId || null,
    title: info.title || null,
    bookedAt: new Date().toISOString(),
    status: "scheduled",
  };
  scheduleStore[slotId] = entry;
  saveSchedule();
  return { slot: entry };
}

function releaseSlot(slotId) {
  if (!scheduleStore[slotId]) return { error: "Slot not booked" };
  delete scheduleStore[slotId];
  saveSchedule();
  return { success: true };
}

// Active YouTube posting jobs keyed by slotId
const ytPostJobs = {};

// Bridge to bot/ytPost.js — spawns it as a detached background process with
// <projectId> and the slot's scheduled datetime. The script itself is owned by
// someone else; we only link to it and track its exit status here.
function triggerYtPost(projectId, slotId, slotAtIso) {
  const scriptPath = path.join(__dirname, "bot", "ytPost.js");
  const logDir = path.join(STORAGE_ROOT, "logs");
  fs.mkdirSync(logDir, { recursive: true });
  const logFile = path.join(logDir, `yt-${projectId}-${slotId}.log`);

  const args = [scriptPath, projectId, slotAtIso];
  const child = spawn(process.execPath, args, {
    cwd: __dirname,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PROJECTS_ROOT: path.join(STORAGE_ROOT, "projects") },
  });

  const logStream = fs.createWriteStream(logFile, { flags: "w" });
  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);

  ytPostJobs[slotId] = { pid: child.pid, projectId, startedAt: Date.now(), logFile };

  if (scheduleStore[slotId]) {
    scheduleStore[slotId].status = "posting";
    scheduleStore[slotId].logFile = logFile;
    saveSchedule();
  }

  child.on("close", (code) => {
    const job = ytPostJobs[slotId];
    if (scheduleStore[slotId]) {
      scheduleStore[slotId].status = code === 0 ? "posted" : "failed";
      scheduleStore[slotId].finishedAt = new Date().toISOString();
      scheduleStore[slotId].exitCode = code;
      saveSchedule();
    }
    delete ytPostJobs[slotId];
    console.log(
      `[ytPost] ${projectId} slot ${slotId} exited code=${code}${job ? ` (log: ${logFile})` : ""}`,
    );
  });
  child.on("error", (err) => {
    if (scheduleStore[slotId]) {
      scheduleStore[slotId].status = "failed";
      scheduleStore[slotId].error = err.message;
      saveSchedule();
    }
    delete ytPostJobs[slotId];
    console.error(`[ytPost] failed to spawn for ${projectId}/${slotId}:`, err.message);
  });

  child.unref();
  return { pid: child.pid, logFile };
}

// ---- Automatic daily story generation + YouTube posting ----
// Fires at each SLOTS time (8:00 AM / 7:00 PM local). Picks the bottom-most
// (last) pending story, generates it with AUTO_TEMPLATE_ID, then posts the
// finished video to YouTube scheduled for the next free slot.
let autoRunning = false;

function bottomMostPendingStory() {
  for (let i = storiesStore.length - 1; i >= 0; i--) {
    if (storiesStore[i].status === "pending") return storiesStore[i];
  }
  return null;
}

function autoStartGeneration(storyId, onDone, templateId) {
  const s = getStory(storyId);
  if (!s) return onDone(new Error("Story not found"));
  if (s.status === "generating") return onDone(new Error("Already generating"));

  const template = loadTemplates().find((t) => t.id === (templateId || AUTO_TEMPLATE_ID));
  if (!template) return onDone(new Error(`Unknown template ${templateId || AUTO_TEMPLATE_ID}`));

  const projectId = `q-${s.id}`;
  const input = s.about ? `${s.title}. ${s.about}` : s.title;

  updateStory(s.id, {
    status: "generating",
    templateId: template.id,
    projectId,
    startedAt: Date.now(),
    completedAt: null,
    error: null,
    videoUrl: null,
    currentStep: "input",
  });
  storyProgress[s.id] = { step: "input", label: "Starting (auto)", completed: 0, total: 0 };

  runOneShotPipeline({
    projectId,
    input,
    template,
    onProgress: (p) => {
      if (!p || !p.step) return;
      storyProgress[s.id] = {
        step: p.step,
        label: p.label || p.step,
        completed: p.completed || 0,
        total: p.total || 0,
        updatedAt: Date.now(),
      };
    },
  })
    .then((result) => {
      delete storyProgress[s.id];
      updateStory(s.id, {
        status: "generated",
        completedAt: Date.now(),
        videoUrl: result.videoUrl,
        currentStep: "done",
      });
      console.log(`[auto] story '${s.id}' generated -> ${projectId}`);
      onDone(null, { story: s, projectId });
    })
    .catch((err) => {
      delete storyProgress[s.id];
      updateStory(s.id, {
        status: "failed",
        error: err.message,
        completedAt: Date.now(),
      });
      console.error(`[auto] story '${s.id}' failed:`, err.message);
      onDone(err);
    });
}

function autoPostToYoutube({ projectId, title }) {
  const nextSlots = getNextAvailableSlots(1, new Date());
  if (nextSlots.length === 0) {
    throw new Error("No available YouTube slots to book");
  }
  const next = nextSlots[0];
  const booked = bookSlot(next.slotId, {
    projectId,
    platform: "youtube",
    title: title || projectId,
  });
  if (booked.error) throw new Error(`bookSlot: ${booked.error}`);
  const job = triggerYtPost(projectId, next.slotId, next.at);
  console.log(
    `[auto] posting ${projectId} -> slot ${next.slotId} (${next.label}) pid=${job.pid}`,
  );
}

async function autoTick() {
  if (!AUTO_GENERATION_ENABLED) return;
  if (autoRunning) return;

  const now = new Date();
  const slotId = makeSlotId(now, SLOTS.find((s) => s.hour === now.getHours() && s.minute === now.getMinutes())?.key);
  if (!slotId || String(slotId).endsWith("undefined")) return;

  // Fire only once per slot: skip if the slot is already booked (even for
  // posting a generated video) or already past.
  if (isSlotBooked(slotId)) return;
  const detail = slotDetail(slotId);
  if (!detail) return;
  const slotTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), detail.slot.hour, detail.slot.minute);
  if (now - slotTime > 60 * 1000) return; // only fire during the slot minute

  const story = bottomMostPendingStory();
  if (!story) {
    console.log(`[auto] slot ${slotId} fired but no pending stories`);
    return;
  }

  // Book the current slot immediately so a restart or second tick won't double-fire.
  bookSlot(slotId, { platform: "auto", title: story.title, storyId: story.id });

  autoRunning = true;
  console.log(`[auto] slot ${slotId} -> generating '${story.title}' (${story.id})`);
  autoStartGeneration(story.id, (err, result) => {
    autoRunning = false;
    if (err) return;
    try {
      autoPostToYoutube({ projectId: result.projectId, title: result.story.title });
      if (scheduleStore[slotId]) {
        scheduleStore[slotId].status = "posted";
        scheduleStore[slotId].projectId = result.projectId;
        scheduleStore[slotId].storyId = result.story.id;
        saveSchedule();
      }
    } catch (e) {
      console.error(`[auto] post step failed for slot ${slotId}:`, e.message);
      if (scheduleStore[slotId]) {
        scheduleStore[slotId].status = "failed";
        scheduleStore[slotId].error = e.message;
        saveSchedule();
      }
    }
  });
}

function startAutoScheduler() {
  // On boot, any slot left in "posting" from a pre-restart ytPost child is
  // stuck forever; mark it failed so the slot can be re-booked manually.
  for (const [slotId, entry] of Object.entries(scheduleStore)) {
    if (entry && entry.status === "posting") {
      entry.status = "failed";
      entry.error = "Interrupted (server restarted)";
      console.log(`[auto] marked stuck slot ${slotId} failed (posting on boot)`);
    }
  }
  saveSchedule();

  if (!AUTO_GENERATION_ENABLED) {
    console.log("[auto] scheduler DISABLED (AUTO_GENERATION_ENABLED=false)");
    return;
  }
  setInterval(autoTick, AUTO_POLL_INTERVAL_MS);
  console.log(`[auto] scheduler enabled (template=${AUTO_TEMPLATE_ID}, slots=${SLOTS.map((s) => s.label).join(", ")})`);
}

// Manual trigger: same as a scheduled slot firing, but run now instead of
// waiting for 8:00 AM / 7:00 PM. Picks the bottom-most pending story,
// generates it with AUTO_TEMPLATE_ID, then posts it to YouTube at the next
// free slot.
app.post("/api/auto/generate-now", (req, res) => {
  if (!AUTO_GENERATION_ENABLED) {
    return res
      .status(400)
      .json({ success: false, error: "Auto generation is disabled (AUTO_GENERATION_ENABLED=false)" });
  }
  if (autoRunning) {
    return res.status(409).json({ success: false, error: "An auto generation is already running" });
  }
  const { templateId } = req.body || {};
  const template = loadTemplates().find((t) => t.id === (templateId || AUTO_TEMPLATE_ID));
  if (!template) {
    return res.status(400).json({ success: false, error: `Unknown template ${templateId || AUTO_TEMPLATE_ID}` });
  }
  const story = bottomMostPendingStory();
  if (!story) {
    return res.status(404).json({ success: false, error: "No pending stories in queue" });
  }

  // Book the current slot so the scheduled tick won't double-fire later.
  const slotId = makeSlotId(new Date(), "manual");
  bookSlot(slotId, { platform: "auto", title: story.title, storyId: story.id, manual: true });

  autoRunning = true;
  console.log(`[manual] generating '${story.title}' (${story.id}) now with template ${template.id}`);
  autoStartGeneration(story.id, (err, result) => {
    autoRunning = false;
    if (err) return;
    try {
      autoPostToYoutube({ projectId: result.projectId, title: result.story.title });
    } catch (e) {
      console.error(`[manual] post step failed:`, e.message);
    }
  }, template.id);

  res.json({ success: true, storyId: story.id, projectId: `q-${story.id}`, templateId: template.id, message: "Generation started" });
});

function getSlotsForRange(fromDate, days) {
  const out = [];
  const day = new Date(fromDate.getFullYear(), fromDate.getMonth(), fromDate.getDate());
  for (let i = 0; i < days; i++) {
    for (const slot of SLOTS) {
      const slotId = makeSlotId(day, slot.key);
      const slotTime = new Date(
        day.getFullYear(),
        day.getMonth(),
        day.getDate(),
        slot.hour,
        slot.minute,
      );
      const booked = isSlotBooked(slotId);
      out.push({
        slotId,
        date: formatDateYMD(day),
        slotKey: slot.key,
        label: slot.label,
        hour: slot.hour,
        minute: slot.minute,
        at: slotTime.toISOString(),
        past: slotTime.getTime() < Date.now(),
        booked,
        booking: booked ? getSlotPublic(slotId) : null,
      });
    }
    day.setDate(day.getDate() + 1);
  }
  return out;
}

loadSchedule();
startAutoScheduler();

async function generateStoryText({ input, model, ssml }) {
  const selectedModel = model || DEFAULT_MODEL;
  if (!selectedModel) throw new Error("No model selected");
  const systemPrompt = ssml ? SYSTEM_PROMPT_SSML : SYSTEM_PROMPT_NO_SSML;
  const result = await generateText({
    model: openrouter.chat(selectedModel),
    system: systemPrompt,
    prompt: input,
  });
  return result.text.trim();
}

function buildWavHeader(pcmLength, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmLength, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcmLength, 40);
  return header;
}

async function generateTtsAudio({ text, provider, voice, speaker, language }) {
  if (!text) throw new Error("Text is required");

  if (provider === "openrouter") {
    const orKey = process.env.OPENROUTER_TTS_API_KEY || process.env.OPENROUTER_API_KEY;
    if (!orKey) throw new Error("OPENROUTER_TTS_API_KEY not configured");

    const postData = JSON.stringify({
      model: "google/gemini-3.1-flash-tts-preview",
      input: text,
      voice: voice || "zephyr",
    });

    const audioBase64 = await new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: "openrouter.ai",
          path: "/api/v1/audio/speech",
          method: "POST",
          headers: {
            Authorization: `Bearer ${orKey}`,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(postData),
          },
        },
        (response) => {
          const chunks = [];
          response.on("data", (chunk) => chunks.push(chunk));
          response.on("end", () => {
            if (response.statusCode !== 200) {
              const errBody = Buffer.concat(chunks).toString();
              return reject(
                new Error(
                  `OpenRouter TTS error (${response.statusCode}): ${errBody}`,
                ),
              );
            }
            const pcm = Buffer.concat(chunks);
            const wav = Buffer.concat([buildWavHeader(pcm.length), pcm]);
            resolve(wav.toString("base64"));
          });
        },
      );
      req.on("error", reject);
      req.write(postData);
      req.end();
    });

    return { audio: audioBase64, format: "wav" };
  }

  if (!sarvamClient) {
    throw new Error("SARVAM_API_KEY not configured");
  }

  const response = await sarvamClient.textToSpeech.convert({
    text,
    target_language_code: language || "hi-IN",
    speaker: speaker || "shubh",
    model: "bulbul:v3",
    speech_sample_rate: 24000,
    audio_format: "wav",
  });

  return {
    audio: response?.audios?.[0] || null,
    format: "wav",
    request_id: response?.request_id,
  };
}

async function generateSubtitleSrt({ audio, provider }) {
  if (!audio) throw new Error("Audio is required");

  if (provider === "colab") {
    if (!COLAB_WHISPER_URL) throw new Error("COLAB_WHISPER_URL not configured");

    const response = await fetch(`${COLAB_WHISPER_URL}/transcribe`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "1",
      },
      body: JSON.stringify({
        base64_data: `data:audio/wav;base64,${audio}`,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Colab whisper: ${response.status} ${errText}`);
    }

    const data = await response.json();
    if (data.status !== "success" || !data.transcription?.segments) {
      throw new Error("Colab whisper: unexpected response");
    }

    return segmentsToSrt(data.transcription.segments);
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY not configured");
  }

  const tempDir = path.join(__dirname, "temp");
  await fsPromises.mkdir(tempDir, { recursive: true });
  const tempFile = path.join(tempDir, `audio_${Date.now()}.wav`);
  await fsPromises.writeFile(tempFile, audio, "base64");

  const transcription = await openai.audio.transcriptions.create({
    file: fs.createReadStream(tempFile),
    model: "whisper-1",
    language: "hi",
    response_format: "vtt",
  });

  await fsPromises.unlink(tempFile);

  return vttToSrt(transcription);
}

async function generateImagePromptsList({ subtitle }) {
  if (!subtitle) throw new Error("Subtitle (SRT) is required");

  const selectedModel = DEFAULT_MODEL;
  if (!selectedModel) throw new Error("No model selected");

  const result = await generateText({
    model: openrouter.chat(selectedModel),
    system: SYSTEM_PROMPT_IMAGE,
    prompt: subtitle,
  });

  let responseText = result.text.trim();
  let finalPrompts;
  let entities = null;

  try {
    const parsed = JSON.parse(responseText);

    if (parsed.entities && parsed.prompts) {
      entities = parsed.entities;
      finalPrompts = parsed.prompts.map((prompt) => {
        let resolved = prompt;
        for (const [placeholder, value] of Object.entries(parsed.entities)) {
          const escapedPlaceholder = placeholder.replace(
            /[.*+?^${}()|[\]\\]/g,
            "\\$&",
          );
          resolved = resolved.replace(
            new RegExp(escapedPlaceholder, "g"),
            value,
          );
        }
        return resolved;
      });
    } else if (Array.isArray(parsed)) {
      finalPrompts = parsed;
    } else {
      throw new Error("Unexpected format");
    }
  } catch (parseError) {
    const arrayMatch = responseText.match(/\[[\s\S]*\]/);
    if (arrayMatch) {
      finalPrompts = JSON.parse(arrayMatch[0]);
    } else {
      throw new Error("Could not parse image prompts response");
    }
  }

  return { prompts: JSON.stringify(finalPrompts), entities };
}

async function generateYtMetadataText({ story, subtitle }) {
  if (!story && !subtitle) {
    throw new Error("Story or subtitle is required");
  }

  const selectedModel = DEFAULT_MODEL;
  if (!selectedModel) throw new Error("No model selected");

  const input = story || subtitle;
  const result = await generateText({
    model: openrouter.chat(selectedModel),
    system: SYSTEM_PROMPT_YT,
    prompt: input,
  });

  return result.text.trim();
}

async function parseImagePromptsFile(projectDir) {
  const promptsPath = path.join(projectDir, "image-prompts.json");
  const promptsContent = await fsPromises.readFile(promptsPath, "utf8");
  try {
    return JSON.parse(promptsContent);
  } catch {
    const match = promptsContent.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Invalid prompts format");
  }
}

async function getImagesStartIndex(imageDir) {
  await fsPromises.mkdir(imageDir, { recursive: true });
  const existingFiles = await fsPromises.readdir(imageDir);
  return existingFiles.filter((f) => f.endsWith(".png")).length;
}

async function generateImagesRunpodInternal(projectId, onProgress) {
  if (!RUNPOD_API_KEY) throw new Error("RUNPOD_API_KEY not configured");

  const projectDir = await getProjectDir(projectId);
  const imageDir = path.join(projectDir, "images");
  await fsPromises.mkdir(imageDir, { recursive: true });

  const prompts = await parseImagePromptsFile(projectDir);
  const startIndex = await getImagesStartIndex(imageDir);
  const totalCount = prompts.length;

  if (startIndex >= totalCount) {
    onProgress?.({ completed: totalCount, total: totalCount });
    return { completed: totalCount, total: totalCount };
  }

  for (let i = startIndex; i < totalCount; i++) {
    onProgress?.({ completed: i, total: totalCount });
    const prompt = prompts[i];
    try {
      const response = await fetch(`${RUNPOD_ENDPOINT}/runsync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${RUNPOD_API_KEY}`,
        },
        body: JSON.stringify({
          input: { prompt, width: 512, height: 922 },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`RunPod API error: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      if (data.output?.images?.[0]?.base64) {
        await fsPromises.writeFile(
          path.join(imageDir, `${i + 1}.png`),
          data.output.images[0].base64,
          "base64",
        );
      } else {
        throw new Error("No image in response");
      }
    } catch (err) {
      err.completed = i;
      err.total = totalCount;
      throw err;
    }
  }

  onProgress?.({ completed: totalCount, total: totalCount });
  return { completed: totalCount, total: totalCount };
}

const DEFAULT_NEGATIVE_PROMPT =
  "lowres, low quality, worst quality, blurry, deformed, distorted, bad anatomy, wrong anatomy, extra fingers, missing fingers, mutated hands, poorly drawn hands, poorly drawn face, extra limbs, missing limbs, cloned face, disfigured, malformed, mutation, bad proportions, watermark, text, signature, logo, caption, jpeg artifacts, ugly, duplicate, glitch, error, nsfw, scary, violent, gloomy";

function resolveWorkflowPath(workflowOverride) {
  if (!workflowOverride) return COMFY_WORKFLOW;
  return path.isAbsolute(workflowOverride)
    ? workflowOverride
    : path.join(__dirname, "comfy-workflows", workflowOverride);
}

async function generateImagesComfyInternal(projectId, options = {}, onProgress) {
  const { workflow: workflowOverride, negativePrompt } = options;

  if (!COMFY_URL) throw new Error("COMFY_URL not configured");
  const client = await getComfyClient();
  if (!client) throw new Error("ComfyUI client not available");

  try {
    await fetch(`${COMFY_URL}/queue`);
  } catch (connErr) {
    console.error("ComfyUI connection test failed:", connErr.message);
  }

  const projectDir = await getProjectDir(projectId);
  const imageDir = path.join(projectDir, "images");
  await fsPromises.mkdir(imageDir, { recursive: true });

  const prompts = await parseImagePromptsFile(projectDir);
  const startIndex = await getImagesStartIndex(imageDir);
  const totalCount = prompts.length;

  if (startIndex >= totalCount) {
    onProgress?.({ completed: totalCount, total: totalCount });
    return { completed: totalCount, total: totalCount };
  }

  const workflowPath = resolveWorkflowPath(workflowOverride);
  const inputs = {
    prompt: "",
    height: 922,
    width: 512,
  };
  if (negativePrompt !== undefined && negativePrompt !== null) {
    inputs.negative_prompt = negativePrompt;
  }

  for (let i = startIndex; i < totalCount; i++) {
    onProgress?.({ completed: i, total: totalCount });
    const prompt = prompts[i];
    try {
      inputs.prompt = prompt;
      const result = await client.generateImage({
        workflow: workflowPath,
        inputs,
        output: { type: "base64" },
      });

      if (result.images?.[0]?.base64) {
        const base64Data = result.images[0].base64.split(",")[1];
        await fsPromises.writeFile(
          path.join(imageDir, `${i + 1}.png`),
          base64Data,
          "base64",
        );
        console.log(`Image ${i + 1} saved via ComfyUI`);
      } else {
        throw new Error("No image in ComfyUI response");
      }
    } catch (err) {
      err.completed = i;
      err.total = totalCount;
      throw err;
    }
  }

  onProgress?.({ completed: totalCount, total: totalCount });
  return { completed: totalCount, total: totalCount };
}

async function renderVideoForProject(projectId, renderer, onProgress) {
  if (!["ffmpeg", "remotion"].includes(renderer)) {
    throw new Error("Invalid video renderer");
  }

  const projectDir = await getProjectDir(projectId);
  const audioPath = path.join(projectDir, "audio.wav");
  const srtPath = path.join(projectDir, "subtitle.srt");
  const imageDir = path.join(projectDir, "images");

  if (!fs.existsSync(audioPath)) throw new Error("Audio not found");
  if (!fs.existsSync(srtPath)) throw new Error("Subtitle not found");
  if (!fs.existsSync(imageDir)) throw new Error("Images not found");

  const images = fs.readdirSync(imageDir).filter((f) => f.endsWith(".png"));
  if (images.length === 0) throw new Error("No images found");

  const renderVideo =
    renderer === "remotion" ? createStoryVideoRemotion : createStoryVideoFfmpeg;
  return renderVideo(projectId, onProgress);
}

async function runOneShotPipeline({ projectId, input, template, onProgress }) {
  const cfg = template.config || {};
  const projectDir = await getProjectDir(projectId);

  await fsPromises.writeFile(path.join(projectDir, "input.txt"), input || "");
  onProgress({ step: "input", label: "Input saved", status: "done" });

  const story = await generateStoryText({
    input,
    model: cfg.model || null,
    ssml: cfg.ssml !== false,
  });
  await fsPromises.writeFile(path.join(projectDir, "story.txt"), story);
  onProgress({ step: "story", label: "Story generated", status: "done" });

  const ttsCfg = cfg.tts || {};
  const tts = await generateTtsAudio({
    text: story,
    provider: ttsCfg.provider || "openrouter",
    voice: ttsCfg.voice,
    speaker: ttsCfg.speaker,
    language: ttsCfg.language,
  });
  if (tts.audio) {
    await fsPromises.writeFile(
      path.join(projectDir, "audio.wav"),
      tts.audio,
      "base64",
    );
  }
  onProgress({ step: "audio", label: "Audio generated", status: "done" });

  const subCfg = cfg.subtitle || {};
  const srt = await generateSubtitleSrt({
    audio: tts.audio,
    provider: subCfg.provider || "openai",
  });
  await fsPromises.writeFile(path.join(projectDir, "subtitle.srt"), srt);
  onProgress({ step: "subtitle", label: "Subtitle generated", status: "done" });

  const { prompts, entities } = await generateImagePromptsList({ subtitle: srt });
  await fsPromises.writeFile(path.join(projectDir, "image-prompts.json"), prompts);
  if (entities) {
    await fsPromises.writeFile(
      path.join(projectDir, "image-entities.json"),
      JSON.stringify(entities, null, 2),
    );
  }
  onProgress({
    step: "imagePrompts",
    label: "Image prompts generated",
    status: "done",
  });

  const imgCfg = cfg.images || {};
  const imgProvider = imgCfg.provider || "runpod";
  const onImgProgress = (p) =>
    onProgress({
      step: "images",
      label: `Generating images ${p.completed}/${p.total}`,
      status: "running",
      completed: p.completed,
      total: p.total,
    });

  if (imgProvider === "runpod") {
    await generateImagesRunpodInternal(projectId, onImgProgress);
  } else if (imgProvider === "comfy") {
    await generateImagesComfyInternal(
      projectId,
      {
        workflow: imgCfg.workflow,
        negativePrompt:
          imgCfg.negativePrompt !== undefined
            ? imgCfg.negativePrompt
            : DEFAULT_NEGATIVE_PROMPT,
      },
      onImgProgress,
    );
  } else {
    throw new Error(`Image provider '${imgProvider}' not supported in one-shot`);
  }
  onProgress({ step: "images", label: "Images generated", status: "done" });

  const vidCfg = cfg.video || {};
  const renderer = vidCfg.renderer || "remotion";
  await renderVideoForProject(projectId, renderer, (p) =>
    onProgress({
      step: "video",
      label: p.message || "Rendering video",
      status: "running",
    }),
  );
  onProgress({ step: "video", label: "Video rendered", status: "done" });

  let ytMetadata = null;
  if (cfg.ytSeo !== false) {
    ytMetadata = await generateYtMetadataText({ story });
    await fsPromises.writeFile(
      path.join(projectDir, "yt-metadata.txt"),
      ytMetadata,
    );
    onProgress({ step: "ytSeo", label: "YouTube SEO generated", status: "done" });
  }

  return {
    projectId,
    story,
    ytMetadata,
    videoUrl: `/api/project/${projectId}/video`,
  };
}

app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/models", (req, res) => {
  res.json({ models: AVAILABLE_MODELS, default: DEFAULT_MODEL });
});

app.get("/api/templates", (req, res) => {
  res.json({ success: true, templates: loadTemplates() });
});

app.post("/api/one-shot", async (req, res) => {
  const { templateId, input, projectId: providedProjectId } = req.body;

  const template = loadTemplates().find((t) => t.id === templateId);
  if (!template) {
    return res.status(400).json({ success: false, error: "Unknown template" });
  }
  if (!input || !input.trim()) {
    return res
      .status(400)
      .json({ success: false, error: "Input story is required" });
  }

  const projectId = providedProjectId || `os-${Date.now()}`;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
  const heartbeat = setInterval(() => res.write(`: ping\n\n`), 15000);

  const onClose = () => {};
  req.on("close", onClose);

  try {
    const result = await runOneShotPipeline({
      projectId,
      input,
      template,
      onProgress: (p) => send({ type: "progress", ...p }),
    });
    send({ type: "done", ...result });
  } catch (error) {
    console.error("One-shot pipeline error:", error);
    send({ type: "error", message: error.message });
  } finally {
    clearInterval(heartbeat);
    req.off("close", onClose);
    res.end();
  }
});

app.get("/api/stories", (req, res) => {
  res.json({ success: true, stories: storiesStore.map(storyPublic) });
});

app.get("/api/stories/:id", (req, res) => {
  const s = getStory(req.params.id);
  if (!s) return res.status(404).json({ success: false, error: "Story not found" });
  res.json({ success: true, story: storyPublic(s) });
});

app.post("/api/stories", (req, res) => {
  const incoming = Array.isArray(req.body)
    ? req.body
    : Array.isArray(req.body?.stories)
      ? req.body.stories
      : [];
  const existingIds = new Set(storiesStore.map((s) => s.id));
  let added = 0;
  for (const item of incoming) {
    if (!item || !item.title) continue;
    const id = slugify(item.title);
    if (existingIds.has(id)) continue;
    storiesStore.push({
      id,
      title: item.title,
      about: item.about || "",
      status: "pending",
    });
    existingIds.add(id);
    added++;
  }
  saveStories();
  res.json({ success: true, added, total: storiesStore.length });
});

app.post("/api/stories/:id/start", async (req, res) => {
  const { templateId } = req.body || {};
  const s = getStory(req.params.id);
  if (!s) return res.status(404).json({ success: false, error: "Story not found" });

  const template = loadTemplates().find((t) => t.id === templateId);
  if (!template) {
    return res.status(400).json({ success: false, error: "Unknown template" });
  }
  if (s.status === "generating") {
    return res.status(409).json({ success: false, error: "Already generating" });
  }

  const projectId = `q-${s.id}`;
  const input = s.about ? `${s.title}. ${s.about}` : s.title;

  updateStory(s.id, {
    status: "generating",
    templateId,
    projectId,
    startedAt: Date.now(),
    completedAt: null,
    error: null,
    videoUrl: null,
    currentStep: "input",
  });
  storyProgress[s.id] = { step: "input", label: "Starting", completed: 0, total: 0 };

  res.json({ success: true, projectId });

  runOneShotPipeline({
    projectId,
    input,
    template,
    onProgress: (p) => {
      if (!p || !p.step) return;
      storyProgress[s.id] = {
        step: p.step,
        label: p.label || p.step,
        completed: p.completed || 0,
        total: p.total || 0,
        updatedAt: Date.now(),
      };
    },
  })
    .then((result) => {
      delete storyProgress[s.id];
      updateStory(s.id, {
        status: "generated",
        completedAt: Date.now(),
        videoUrl: result.videoUrl,
        currentStep: "done",
      });
      console.log(`Queue story '${s.id}' generated -> ${projectId}`);
    })
    .catch((err) => {
      delete storyProgress[s.id];
      updateStory(s.id, {
        status: "failed",
        error: err.message,
        completedAt: Date.now(),
      });
      console.error(`Queue story '${s.id}' failed:`, err.message);
    });
});

app.post("/api/stories/:id/reset", (req, res) => {
  const s = getStory(req.params.id);
  if (!s) return res.status(404).json({ success: false, error: "Story not found" });
  delete storyProgress[s.id];
  updateStory(s.id, {
    status: "pending",
    error: null,
    currentStep: null,
    startedAt: null,
    completedAt: null,
  });
  res.json({ success: true, story: storyPublic(s) });
});

app.delete("/api/stories/:id", (req, res) => {
  const idx = storiesStore.findIndex((s) => s.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, error: "Story not found" });
  const [removed] = storiesStore.splice(idx, 1);
  delete storyProgress[removed.id];
  saveStories();
  res.json({ success: true });
});

async function readProjectMeta(projectId) {
  const projectDir = path.join(STORAGE_ROOT, "projects", projectId);
  const meta = {
    projectId,
    title: projectId,
    preview: "",
    hasInput: false,
    hasStory: false,
    hasAudio: false,
    hasSubtitle: false,
    hasImagePrompts: false,
    hasImages: false,
    hasVideo: false,
    hasYtMetadata: false,
    imageCount: 0,
    createdAt: null,
    updatedAt: null,
    thumbnail: null,
  };

  const statSafe = async (p) => {
    try {
      return await fsPromises.stat(p);
    } catch {
      return null;
    }
  };

  const dirStat = await statSafe(projectDir);
  if (!dirStat) return meta;
  meta.createdAt = dirStat.birthtimeMs || dirStat.ctimeMs || dirStat.mtimeMs;
  meta.updatedAt = dirStat.mtimeMs;

  const candidates = [
    ["input.txt", "Input"],
    ["story.txt", "Story"],
    ["audio.wav", "Audio"],
    ["subtitle.srt", "Subtitle"],
    ["image-prompts.json", "ImagePrompts"],
    ["yt-metadata.txt", "YtMetadata"],
    ["video.mp4", "Video"],
  ];

  for (const [filename, key] of candidates) {
    const filePath = path.join(projectDir, filename);
    const st = await statSafe(filePath);
    if (!st) continue;
    meta[`has${key}`] = true;
    if (st.mtimeMs > meta.updatedAt) meta.updatedAt = st.mtimeMs;

    if (key === "Input" || key === "Story") {
      try {
        const content = await fsPromises.readFile(filePath, "utf8");
        const trimmed = content.trim();
        if (key === "Input" && trimmed) {
          meta.preview = trimmed.slice(0, 200);
        }
        if (key === "Story" && trimmed) {
          const firstLine =
            trimmed.split("\n").find((l) => l.trim().length > 0) || "";
          meta.title = firstLine.slice(0, 120);
        }
      } catch {}
    }
  }

  // image-prompts count
  try {
    const promptsPath = path.join(projectDir, "image-prompts.json");
    const content = await fsPromises.readFile(promptsPath, "utf8");
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed)) meta.promptCount = parsed.length;
  } catch {}

  const imageDir = path.join(projectDir, "images");
  const imgDirStat = await statSafe(imageDir);
  if (imgDirStat && imgDirStat.isDirectory()) {
    try {
      const files = await fsPromises.readdir(imageDir);
      const imgs = files
        .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f))
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      meta.imageCount = imgs.length;
      meta.hasImages = imgs.length > 0;
      if (imgs.length > 0) {
        meta.thumbnail = `/api/project/${projectId}/images/${imgs[0]}`;
      }
    } catch {}
  }

  if (meta.hasVideo) {
    meta.videoUrl = `/api/project/${projectId}/video`;
  }

  if (!meta.title || meta.title === projectId) {
    if (meta.preview) meta.title = meta.preview.slice(0, 80);
  }

  return meta;
}

app.get("/api/projects", async (req, res) => {
  try {
    const projectsRoot = path.join(STORAGE_ROOT, "projects");
    await fsPromises.mkdir(projectsRoot, { recursive: true });

    let entries = [];
    try {
      entries = await fsPromises.readdir(projectsRoot, { withFileTypes: true });
    } catch {}

    const dirNames = entries
      .filter((e) => e.isDirectory())
      .map((e) => e.name);

    let projects = await Promise.all(dirNames.map(readProjectMeta));

    const q = (req.query.q || "").toString().trim().toLowerCase();
    if (q) {
      projects = projects.filter(
        (p) =>
          p.projectId.toLowerCase().includes(q) ||
          (p.title || "").toLowerCase().includes(q) ||
          (p.preview || "").toLowerCase().includes(q),
      );
    }

    const sort = (req.query.sort || "updated").toString();
    const order = (req.query.order || "desc").toString() === "asc" ? 1 : -1;

    projects.sort((a, b) => {
      let av, bv;
      switch (sort) {
        case "name":
          av = (a.projectId || "").toLowerCase();
          bv = (b.projectId || "").toLowerCase();
          return av < bv ? -order : av > bv ? order : 0;
        case "created":
          av = a.createdAt || 0;
          bv = b.createdAt || 0;
          return (av - bv) * order;
        case "progress":
          av = a.imageCount + (a.hasVideo ? 1 : 0) + (a.hasAudio ? 1 : 0);
          bv = b.imageCount + (b.hasVideo ? 1 : 0) + (b.hasAudio ? 1 : 0);
          return (av - bv) * order;
        case "updated":
        default:
          av = a.updatedAt || 0;
          bv = b.updatedAt || 0;
          return (av - bv) * order;
      }
    });

    const total = projects.length;
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.max(
      1,
      Math.min(100, parseInt(req.query.limit, 10) || 12),
    );
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const start = (page - 1) * limit;
    const items = projects.slice(start, start + limit);

    res.json({
      success: true,
      total,
      page,
      limit,
      totalPages,
      sort,
      order: order === 1 ? "asc" : "desc",
      projects: items,
    });
  } catch (error) {
    console.error("Error listing projects:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/project/:projectId", async (req, res) => {
  try {
    const projectDir = await getProjectDir(req.params.projectId);
    const inputPath = path.join(projectDir, "input.txt");
    const storyPath = path.join(projectDir, "story.txt");
    const audioPath = path.join(projectDir, "audio.wav");
    const subtitlePath = path.join(projectDir, "subtitle.srt");
    const imagePromptsPath = path.join(projectDir, "image-prompts.json");
    const ytMetadataPath = path.join(projectDir, "yt-metadata.txt");

    let data = { projectId: req.params.projectId };

    try {
      data.input = await fsPromises.readFile(inputPath, "utf8");
    } catch {}
    try {
      data.story = await fsPromises.readFile(storyPath, "utf8");
    } catch {}
    try {
      data.audio = await fsPromises.readFile(audioPath, "base64");
    } catch {}
    try {
      data.subtitle = await fsPromises.readFile(subtitlePath, "utf8");
    } catch {}
    try {
      data.imagePrompts = await fsPromises.readFile(imagePromptsPath, "utf8");
    } catch {}
    try {
      data.ytMetadata = await fsPromises.readFile(ytMetadataPath, "utf8");
    } catch {}

    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/project/:projectId/input", async (req, res) => {
  try {
    const { content } = req.body;
    const projectDir = await getProjectDir(req.params.projectId);
    await fsPromises.writeFile(
      path.join(projectDir, "input.txt"),
      content || "",
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/project/:projectId/story", async (req, res) => {
  try {
    const { content } = req.body;
    const projectDir = await getProjectDir(req.params.projectId);
    await fsPromises.writeFile(
      path.join(projectDir, "story.txt"),
      content || "",
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/project/:projectId/audio", async (req, res) => {
  try {
    const { content } = req.body;
    const projectDir = await getProjectDir(req.params.projectId);
    if (content) {
      await fsPromises.writeFile(
        path.join(projectDir, "audio.wav"),
        content,
        "base64",
      );
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/project/:projectId/subtitle", async (req, res) => {
  try {
    const { content } = req.body;
    const projectDir = await getProjectDir(req.params.projectId);
    if (content) {
      await fsPromises.writeFile(
        path.join(projectDir, "subtitle.srt"),
        content,
      );
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/project/:projectId/image-prompts", async (req, res) => {
  try {
    const { content } = req.body;
    const projectDir = await getProjectDir(req.params.projectId);
    if (content) {
      await fsPromises.writeFile(
        path.join(projectDir, "image-prompts.json"),
        content,
      );
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/project/:projectId/yt-metadata", async (req, res) => {
  try {
    const { content } = req.body;
    const projectDir = await getProjectDir(req.params.projectId);
    if (content) {
      await fsPromises.writeFile(
        path.join(projectDir, "yt-metadata.txt"),
        content,
      );
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/generate", async (req, res) => {
  const { story, model, ssml } = req.body;
  if (!story) {
    return res.status(400).json({ success: false, error: "Story is required" });
  }

  try {
    const output = await generateStoryText({
      input: story,
      model,
      ssml: !!ssml,
    });
    res.json({ success: true, output });
  } catch (error) {
    console.error("Error generating story:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/tts", async (req, res) => {
  const { text, speaker, language, provider, voice } = req.body;

  try {
    const result = await generateTtsAudio({
      text,
      provider,
      voice,
      speaker,
      language,
    });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("Error generating TTS:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

function vttToSrt(vtt) {
  let srt = vtt.replace(/WEBVTT\n\n/, "");
  let index = 1;
  srt = srt.replace(/(\d{2}:\d{2}:\d{2})\.(\d{3})/g, (match, time, ms) => {
    return `${time},${ms}`;
  });
  srt = srt.replace(/\n\n/g, (match) => `\n${index++}\n`);
  return srt;
}

function formatSrtTime(seconds) {
  const ms = Math.floor((seconds % 1) * 1000);
  const totalSeconds = Math.floor(seconds);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

function segmentsToSrt(segments) {
  return segments
    .map((seg, i) => {
      const start = formatSrtTime(seg.start);
      const end = formatSrtTime(seg.end);
      return `${i + 1}\n${start} --> ${end}\n${seg.text.trim()}`;
    })
    .join("\n\n");
}

app.post("/api/subtitle", async (req, res) => {
  const { audio, provider } = req.body;

  try {
    const subtitle = await generateSubtitleSrt({ audio, provider });
    res.json({ success: true, subtitle });
  } catch (error) {
    console.error("Error generating subtitle:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/image-prompts", async (req, res) => {
  const { subtitle, projectId } = req.body;

  try {
    const { prompts, entities } = await generateImagePromptsList({ subtitle });

    if (projectId && entities) {
      try {
        const projectDir = await getProjectDir(projectId);
        await fsPromises.writeFile(
          path.join(projectDir, "image-entities.json"),
          JSON.stringify(entities, null, 2),
        );
      } catch (saveError) {
        console.error("Failed to save entity definitions:", saveError.message);
      }
    }

    res.json({ success: true, prompts });
  } catch (error) {
    console.error("Error generating image prompts:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/youtube-metadata", async (req, res) => {
  const { story, subtitle } = req.body;

  try {
    const output = await generateYtMetadataText({ story, subtitle });
    res.json({ success: true, output });
  } catch (error) {
    console.error("Error generating YouTube metadata:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/generate-images", async (req, res) => {
  const { projectId, provider, negativePrompt } = req.body;

  if (!projectId) {
    return res
      .status(400)
      .json({ success: false, error: "Project ID is required" });
  }

  if (provider === "runpod" || !COMFY_URL) {
    return res.redirect(
      `/api/generate-images-runpod?projectId=${projectId}`,
    );
  }

  try {
    const result = await generateImagesComfyInternal(projectId, { negativePrompt });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("Error generating images:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      completed: error.completed,
      total: error.total,
    });
  }
});

app.post("/api/generate-images-openrouter", async (req, res) => {
  const { projectId } = req.body;

  if (!projectId) {
    return res
      .status(400)
      .json({ success: false, error: "Project ID is required" });
  }

  if (!process.env.OPENROUTER_API_KEY) {
    return res
      .status(400)
      .json({ success: false, error: "OPENROUTER_API_KEY not configured" });
  }

  try {
    const projectDir = await getProjectDir(projectId);
    const promptsPath = path.join(projectDir, "image-prompts.json");
    const imageDir = path.join(projectDir, "images");

    await fsPromises.mkdir(imageDir, { recursive: true });

    const promptsContent = await fsPromises.readFile(promptsPath, "utf8");
    let prompts;
    try {
      prompts = JSON.parse(promptsContent);
    } catch {
      const match = promptsContent.match(/\[[\s\S]*\]/);
      if (match) {
        prompts = JSON.parse(match[0]);
      } else {
        throw new Error("Invalid prompts format");
      }
    }

    const existingFiles = await fsPromises.readdir(imageDir);
    const completedCount = existingFiles.filter((f) =>
      f.endsWith(".png"),
    ).length;

    const startIndex = completedCount;
    const totalCount = prompts.length;

    if (startIndex >= totalCount) {
      return res.json({
        success: true,
        message: "All images already generated",
        completed: totalCount,
        total: totalCount,
      });
    }

    console.log(
      `Generating images ${startIndex + 1} to ${totalCount} via OpenRouter...`,
    );

    const imageModel = "sourceful/riverflow-v2-fast";

    for (let i = startIndex; i < totalCount; i++) {
      const prompt = prompts[i];
      console.log(`Generating image ${i + 1}/${totalCount}`);

      try {
        const response = await fetch(
          "https://openrouter.ai/api/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
              "HTTP-Referer": "http://localhost:3000",
              "X-Title": "StoryGenerator",
            },
            body: JSON.stringify({
              model: imageModel,
              messages: [{ role: "user", content: prompt }],
              modalities: ["image"],
            }),
          },
        );

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const message = data.choices?.[0]?.message;

        const imageUrl = message?.images?.[0]?.image_url?.url;
        if (imageUrl) {
          const base64Data = imageUrl.includes(",")
            ? imageUrl.split(",")[1]
            : imageUrl;
          const outputPath = path.join(imageDir, `${i + 1}.png`);
          await fsPromises.writeFile(outputPath, base64Data, "base64");
          console.log(`Image ${i + 1} saved to ${outputPath}`);
        } else {
          console.log(
            `Image ${i + 1} result:`,
            JSON.stringify(data).substring(0, 500),
          );
          throw new Error("No image in response");
        }
      } catch (err) {
        console.error(`Error generating image ${i + 1}:`, err.message);
        return res.status(500).json({
          success: false,
          error: `Failed at image ${i + 1}: ${err.message}`,
          completed: i,
          total: totalCount,
        });
      }
    }

    res.json({
      success: true,
      completed: totalCount,
      total: totalCount,
    });
  } catch (error) {
    console.error("Error generating images:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/api/generate-images-runpod", async (req, res) => {
  const { projectId } = req.body;

  if (!projectId) {
    return res
      .status(400)
      .json({ success: false, error: "Project ID is required" });
  }

  try {
    const result = await generateImagesRunpodInternal(projectId);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("Error generating images:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      completed: error.completed,
      total: error.total,
    });
  }
});

app.get("/api/project/:projectId/images-status", async (req, res) => {
  try {
    const projectDir = await getProjectDir(req.params.projectId);
    const imageDir = path.join(projectDir, "images");

    await fsPromises.mkdir(imageDir, { recursive: true });

    const promptsPath = path.join(projectDir, "image-prompts.json");
    let total = 0;
    try {
      const promptsContent = await fsPromises.readFile(promptsPath, "utf8");
      const prompts = JSON.parse(promptsContent);
      total = Array.isArray(prompts) ? prompts.length : 0;
    } catch {}

    const existingFiles = await fsPromises.readdir(imageDir);
    const completed = existingFiles.filter((f) => f.endsWith(".png")).length;
    const images = existingFiles
      .filter((f) => f.endsWith(".png"))
      .map((f) => ({
        filename: f,
        url: `/api/project/${req.params.projectId}/images/${f}`,
      }));

    res.json({
      success: true,
      completed,
      total,
      images,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/project/:projectId/images/:filename", async (req, res) => {
  try {
    const projectDir = await getProjectDir(req.params.projectId);
    const imagePath = path.resolve(projectDir, "images", req.params.filename);

    await fsPromises.access(imagePath);

    res.sendFile(imagePath);
  } catch (error) {
    console.error("Image error:", error.message);
    res.status(404).send("Not found");
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/story", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "story.html"));
});

// Video Generation Functions
const FPS = 60;
const TARGET_SIZE = { width: 1080, height: 1920 };
const CROSSFADE_DURATION = 0.3;
const ZOOM_RATE = 0.08;

function parseSRT(data) {
  const segments = [];
  const regex =
    /(\d{1,2}:\d{2}:\d{2}[.,]\d{3}) --> (\d{1,2}:\d{2}:\d{2}[.,]\d{3})/g;
  let match;
  const lines = data.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    const timeMatch = line.match(
      /(\d{1,2}:\d{2}:\d{2}[.,]\d{3}) --> (\d{1,2}:\d{2}:\d{2}[.,]\d{3})/,
    );
    if (timeMatch) {
      const textLines = [];
      i++;
      while (i < lines.length) {
        const nextLine = lines[i].trim();
        if (!nextLine || /^\d+$/.test(nextLine)) {
          i++;
          continue;
        }
        if (
          /^\d{1,2}:\d{2}:\d{2}[.,]\d{3} --> \d{1,2}:\d{2}:\d{2}[.,]\d{3}/.test(
            nextLine,
          )
        ) {
          break;
        }
        textLines.push(nextLine);
        i++;
      }
      segments.push({
        startTime: timeMatch[1].replace(",", "."),
        endTime: timeMatch[2].replace(",", "."),
        text: textLines.join(" "),
      });
    } else {
      i++;
    }
  }
  return segments;
}

function srtTimeToMs(timeStr) {
  const parts = timeStr.split(":");
  const [h, m, s] = parts;
  const sec = s.split(".");
  return (
    (parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(sec[0])) * 1000 +
    parseInt(sec[1])
  );
}

async function createImageClip(scene, index, totalScenes, tempDir, imageDir) {
  const duration = (scene.end_ms - scene.start_ms) / 1000.0;
  const outputPath = path.join(tempDir, `clip_${index}.mp4`);
  const startZoom = 1.0;
  const endZoom = 1.0 + duration * ZOOM_RATE;
  const safetyBuffer = 2.0;
  const totalFrames = Math.ceil((duration + safetyBuffer) * FPS);
  const zoomIncrement = (endZoom - startZoom) / (duration * FPS);

  const scaleCropFilter = `scale=${TARGET_SIZE.width}:${TARGET_SIZE.height}:force_original_aspect_ratio=increase,crop=${TARGET_SIZE.width}:${TARGET_SIZE.height}`;
  const zoomFilter = `zoompan=z='min(${startZoom}+on*${zoomIncrement},${endZoom})':d=${totalFrames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=${TARGET_SIZE.width}x${TARGET_SIZE.height}:fps=${FPS}`;

  let fadeFilters = [];
  if (index > 0) fadeFilters.push(`fade=t=in:st=0:d=${CROSSFADE_DURATION}`);
  if (index < totalScenes - 1)
    fadeFilters.push(
      `fade=t=out:st=${Math.max(0, duration - CROSSFADE_DURATION)}:d=${CROSSFADE_DURATION}`,
    );

  let filters = [scaleCropFilter, zoomFilter];
  if (fadeFilters.length > 0) filters = filters.concat(fadeFilters);

  const imagePath = scene.image;

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(imagePath)
      .inputOptions(["-loop", "1", "-framerate", FPS.toString()])
      .videoFilters(filters.join(","))
      .outputOptions([
        "-t",
        duration.toFixed(6),
        "-pix_fmt",
        "yuv420p",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "23",
        "-r",
        FPS.toString(),
        "-vsync",
        "cfr",
        "-g",
        Math.round(FPS).toString(),
        "-fps_mode",
        "cfr",
      ])
      .output(outputPath)
      .on("end", () => resolve(outputPath))
      .on("error", (err) => reject(err))
      .run();
  });
}

async function concatenateClips(clipPaths, tempDir, outputPath) {
  const concatPath = path.join(tempDir, "concat.txt");
  const content = clipPaths.map((p) => `file '${p}'`).join("\n");
  fs.writeFileSync(concatPath, content);

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(concatPath)
      .inputOptions(["-f", "concat", "-safe", "0"])
      .outputOptions([
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-preset",
        "medium",
        "-crf",
        "23",
        "-r",
        FPS.toString(),
        "-vsync",
        "cfr",
      ])
      .output(outputPath)
      .on("end", () => resolve(outputPath))
      .on("error", (err) => reject(err))
      .run();
  });
}

async function addAudio(videoPath, audioPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(audioPath)
      .outputOptions([
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-shortest",
      ])
      .output(outputPath)
      .on("end", () => resolve(outputPath))
      .on("error", (err) => reject(err))
      .run();
  });
}

function runCommand(command, args, onLog) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: __dirname,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (data) => onLog?.(data.toString().trim()));
    child.stderr.on("data", (data) => onLog?.(data.toString().trim()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(`${command} ${args.join(" ")} exited with code ${code}`),
        );
      }
    });
  });
}

async function createStoryVideoRemotion(projectId, onProgress) {
  onProgress({
    status: "remotion",
    message: "Rendering video with Remotion...",
  });

  await runCommand(
    process.execPath,
    ["scripts/render-remotion.js", projectId],
    (message) => {
      if (message) console.log("Remotion render:", message);
    },
  );

  const projectDir = await getProjectDir(projectId);
  const outputPath = path.join(projectDir, "video.mp4");
  onProgress({
    status: "done",
    message: "Remotion video created!",
    progress: 100,
  });
  return outputPath;
}

async function createStoryVideoFfmpeg(projectId, onProgress) {
  const projectDir = await getProjectDir(projectId);
  const imageDir = path.join(projectDir, "images");
  const audioPath = path.join(projectDir, "audio.wav");
  const srtPath = path.join(projectDir, "subtitle.srt");
  const outputPath = path.join(projectDir, "video.mp4");
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "story-video-"));

  console.log("Video temp dir:", tempDir);

  try {
    const srtContent = fs.readFileSync(srtPath, "utf8");
    console.log("SRT content length:", srtContent.length);
    const srtData = parseSRT(srtContent);
    console.log("Parsed SRT segments:", srtData.length);
    const images = fs
      .readdirSync(imageDir)
      .filter((f) => /\.(png|jpg|jpeg|webp)$/i.test(f))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    console.log("Found images:", images.length);

    const scenesData = srtData.map((item, index) => {
      let start_ms = srtTimeToMs(item.startTime);
      let end_ms =
        index < srtData.length - 1
          ? srtTimeToMs(srtData[index + 1].startTime)
          : srtTimeToMs(item.endTime) + 3000;
      if (index === 0 && start_ms > 0) start_ms = 0;
      return {
        image: path.join(imageDir, images[index] || images[images.length - 1]),
        start_ms,
        end_ms,
        text: item.text,
      };
    });

    onProgress({
      status: "clipping",
      message: `Creating ${scenesData.length} clips...`,
    });

    const clipPaths = [];
    for (let i = 0; i < scenesData.length; i++) {
      const clipPath = await createImageClip(
        scenesData[i],
        i,
        scenesData.length,
        tempDir,
        imageDir,
      );
      clipPaths.push(clipPath);
    }

    onProgress({ status: "concatenating", message: "Merging clips..." });

    const tempVideo = path.join(tempDir, "temp_concatenated.mp4");
    await concatenateClips(clipPaths, tempDir, tempVideo);

    onProgress({ status: "audio", message: "Adding audio..." });

    if (!fs.existsSync(audioPath)) throw new Error("Audio file not found");
    await addAudio(tempVideo, audioPath, outputPath);

    fs.rmSync(tempDir, { recursive: true, force: true });

    onProgress({ status: "done", message: "Video created!", progress: 100 });
    return outputPath;
  } catch (error) {
    if (fs.existsSync(tempDir))
      fs.rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
}

// Video generation endpoint
app.post("/api/generate-video", async (req, res) => {
  const { projectId, renderer = "remotion" } = req.body;

  if (!projectId) {
    return res
      .status(400)
      .json({ success: false, error: "Project ID is required" });
  }

  try {
    await renderVideoForProject(projectId, renderer, (progress) => {
      console.log(`Video generation (${renderer}):`, progress.message);
    });

    res.json({
      success: true,
      renderer,
      videoUrl: `/api/project/${projectId}/video`,
    });
  } catch (error) {
    console.error("Video generation error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

let remotionStudioProcess = null;
const REMOTION_STUDIO_PORT = Number(process.env.REMOTION_STUDIO_PORT || 3001);

app.post("/api/remotion-studio", async (req, res) => {
  const { projectId } = req.body;

  if (!projectId) {
    return res
      .status(400)
      .json({ success: false, error: "Project ID is required" });
  }

  try {
    const { propsPath } = await prepareRemotionProject(projectId);
    console.log(propsPath, "props");

    console.log(REMOTION_STUDIO_PORT, "porti");
    
    // Kill process on port using fuser (more targeted)
    try {
      const { execSync } = await import("child_process");
      execSync(`fuser -k ${REMOTION_STUDIO_PORT}/tcp 2>/dev/null || true`, { encoding: "utf8", stdio: "ignore" });
      console.log("port killed");
    } catch (err) {
      console.log("port not in use or already killed");
    }
    
    remotionStudioProcess = spawn(
      "npx",
      [
        "remotion",
        "studio",
        "remotion/index.jsx",
        `--props=${propsPath}`,
        `--port=${REMOTION_STUDIO_PORT}`,
        "--no-open",
      ],
      {
        cwd: __dirname,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    remotionStudioProcess.stdout.on("data", (data) =>
      console.log("Remotion Studio:", data.toString().trim()),
    );
    remotionStudioProcess.stderr.on("data", (data) =>
      console.log("Remotion Studio:", data.toString().trim()),
    );
    remotionStudioProcess.on("close", (code) => {
      console.log(`Remotion Studio exited with code ${code}`);
      remotionStudioProcess = null;
    });

    res.json({
      success: true,
      studioUrl: `http://localhost:${REMOTION_STUDIO_PORT}`,
    });
  } catch (error) {
    console.error("Remotion Studio error:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/project/:projectId/video", async (req, res) => {
  try {
    const projectDir = await getProjectDir(req.params.projectId);
    const videoPath = path.join(projectDir, "video.mp4");
    await fsPromises.access(videoPath);
    res.sendFile(videoPath);
  } catch (error) {
    res.status(404).send("Video not found");
  }
});

app.get("/api/project/:projectId/video-status", async (req, res) => {
  try {
    const projectDir = await getProjectDir(req.params.projectId);
    const videoPath = path.join(projectDir, "video.mp4");
    const exists = fs.existsSync(videoPath);
    res.json({
      success: true,
      exists,
      videoUrl: exists ? `/api/project/${req.params.projectId}/video` : null,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/api/schedule", (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days) || 14, 1), 90);
  const from = req.query.from ? parseYMD(req.query.from) : new Date();
  res.json({ success: true, slots: getSlotsForRange(from, days) });
});

app.get("/api/schedule/next", (req, res) => {
  const count = Math.min(Math.max(parseInt(req.query.count) || 1, 1), 50);
  const from = req.query.from ? new Date(req.query.from) : new Date();
  if (isNaN(from.getTime())) {
    return res.status(400).json({ success: false, error: "Invalid 'from' date" });
  }
  res.json({ success: true, slots: getNextAvailableSlots(count, from) });
});

app.get("/api/schedule/:slotId", (req, res) => {
  const detail = slotDetail(req.params.slotId);
  if (!detail) {
    return res.status(400).json({ success: false, error: "Invalid slotId" });
  }
  res.json({
    success: true,
    slot: {
      slotId: req.params.slotId,
      date: detail.ymd,
      slotKey: detail.key,
      label: detail.slot.label,
      booked: isSlotBooked(req.params.slotId),
      booking: getSlotPublic(req.params.slotId),
    },
  });
});

app.post("/api/schedule/book", (req, res) => {
  const { slotId } = req.body;
  if (!slotId) {
    return res.status(400).json({ success: false, error: "slotId is required" });
  }
  const result = bookSlot(slotId, req.body);
  if (result.error) {
    return res.status(409).json({ success: false, error: result.error, slot: result.slot });
  }
  res.json({ success: true, slot: result.slot });
});

app.post("/api/schedule/book-next", (req, res) => {
  const count = Math.min(Math.max(parseInt(req.body.count) || 1, 1), 50);
  const from = req.body.from ? new Date(req.body.from) : new Date();
  if (isNaN(from.getTime())) {
    return res.status(400).json({ success: false, error: "Invalid 'from' date" });
  }
  const avail = getNextAvailableSlots(count, from);
  if (avail.length === 0) {
    return res.status(409).json({ success: false, error: "No available slots found" });
  }
  const booked = [];
  for (const s of avail) {
    const result = bookSlot(s.slotId, req.body);
    if (result.slot) booked.push(result.slot);
  }
  res.json({ success: true, requested: count, booked: booked.length, slots: booked });
});

app.post("/api/schedule/release", (req, res) => {
  const { slotId } = req.body;
  if (!slotId) {
    return res.status(400).json({ success: false, error: "slotId is required" });
  }
  const result = releaseSlot(slotId);
  if (result.error) {
    return res.status(404).json({ success: false, error: result.error });
  }
  res.json({ success: true });
});

// Schedule a project's video to YouTube: picks the next free slot (or a given
// one), books it, and triggers bot/ytPost.js in the background.
app.post("/api/schedule/youtube", async (req, res) => {
  const { projectId, slotId, title } = req.body || {};
  if (!projectId) {
    return res.status(400).json({ success: false, error: "projectId is required" });
  }

  const projectDir = path.join(STORAGE_ROOT, "projects", projectId);
  if (!fs.existsSync(projectDir)) {
    return res.status(404).json({ success: false, error: "Project not found" });
  }
  const videoFile = path.join(projectDir, "video.mp4");
  const metaFile = path.join(projectDir, "yt-metadata.txt");
  if (!fs.existsSync(videoFile)) {
    return res.status(400).json({ success: false, error: "Project has no video.mp4" });
  }
  if (!fs.existsSync(metaFile)) {
    return res.status(400).json({ success: false, error: "Project has no yt-metadata.txt" });
  }

  let target;
  if (slotId) {
    const detail = slotDetail(slotId);
    if (!detail) {
      return res.status(400).json({ success: false, error: "Invalid slotId" });
    }
    if (isSlotBooked(slotId)) {
      return res
        .status(409)
        .json({ success: false, error: "Slot already booked", slot: getSlotPublic(slotId) });
    }
    target = { slotId, date: detail.ymd, slotKey: detail.key, label: detail.slot.label };
  } else {
    const avail = getNextAvailableSlots(1, new Date());
    if (avail.length === 0) {
      return res.status(409).json({ success: false, error: "No available slots found" });
    }
    const s = avail[0];
    target = { slotId: s.slotId, date: s.date, slotKey: s.slotKey, label: s.label, at: s.at };
  }

  const slotDef = SLOTS.find((sl) => sl.key === target.slotKey);
  const dayDate = parseYMD(target.date);
  const slotTime = new Date(
    dayDate.getFullYear(),
    dayDate.getMonth(),
    dayDate.getDate(),
    slotDef.hour,
    slotDef.minute,
  );

  const booked = bookSlot(target.slotId, {
    projectId,
    platform: "youtube",
    title: title || projectId,
  });
  if (booked.error) {
    return res.status(409).json({ success: false, error: booked.error, slot: booked.slot });
  }

  const job = triggerYtPost(projectId, target.slotId, slotTime.toISOString());

  res.json({
    success: true,
    slot: booked.slot,
    scheduledFor: slotTime.toISOString(),
    post: { pid: job.pid, logFile: job.logFile, triggered: true },
  });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
