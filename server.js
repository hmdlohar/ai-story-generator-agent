import 'dotenv/config';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { promises as fsPromises } from 'fs';
import os from 'os';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateText } from 'ai';
import { SarvamAIClient } from 'sarvamai';
import OpenAI from 'openai';
import { fileURLToPath } from 'url';
import ffmpeg from 'fluent-ffmpeg';

ffmpeg.setFfmpegPath('/usr/bin/ffmpeg');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

const STORAGE_ROOT = path.resolve(process.env.STORAGE_ROOT_DIR || './storage');
const COMFY_URL = process.env.COMFY_URL || '';
const COMFY_WORKFLOW = process.env.COMFY_WORKFLOW || '/media/hyper8/HYPER/Downloads/comfy-workflows/flux-kelin-gguf2.api.json';
const OPENROUTER_IMAGE_MODEL = process.env.OPENROUTER_IMAGE_MODEL || 'black-forest-labs/flux.2-klein-4b';
const IMAGE_WIDTH = 810;
const IMAGE_HEIGHT = 1440;

const AVAILABLE_MODELS = (process.env.AVAILABLE_MODELS || '').split(',').filter(m => m.trim());
const DEFAULT_MODEL = AVAILABLE_MODELS[0] || '';

const openrouter = createOpenRouter({
  apiKey: process.env.OPENROUTER_API_KEY,
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
    console.log('Initializing ComfyClient with URL:', COMFY_URL);
    const { ComfyClient } = await import('hmd-comfy-client');
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
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
}

const SYSTEM_PROMPT_SSML = `You are an expert dialogue and narration writer for text-to-speech, specializing in playful, short-form storytelling for children aged 3–7 and their parents. When a story is provided, you understand its tone, rhythm, and emotions, then write lively, engaging, and easy-to-follow narration and dialogues in modern North Indian Hindi — natural for listeners from UP, Bihar, and nearby regions. Avoid formal or literary Hindi; keep it conversational, fun, and full of energy, crafted for YouTube Shorts so it instantly captures attention and keeps both kids and parents entertained. You can simplify, rephrase, or slightly adapt the story to make it short-worthy and engaging, while preserving the core meaning and emotion. Your output must be valid SSML compatible with Google Text-to-Speech, using natural yet energetic pacing, expressive pauses, prosody, and emphasis. Include natural, fitting sound expressions (like "खौं… खौं…", "गर्र…" or "ऊँ…") when they enhance storytelling — never forced. Maintain a bright, expressive tone with humor, warmth, and curiosity, ensuring the narration feels lively and shareable.`;

const SYSTEM_PROMPT_NO_SSML = `You are an expert dialogue and narration writer for text-to-speech, specializing in playful, short-form storytelling for children aged 3–7 and their parents. When a story is provided, you understand its tone, rhythm, and emotions, then write lively, engaging, and easy-to-follow narration and dialogues in modern North Indian Hindi — natural for listeners from UP, Bihar, and nearby regions. Avoid formal or literary Hindi; keep it conversational, fun, and full of energy, crafted for YouTube Shorts so it instantly captures attention and keeps both kids and parents entertained. You can simplify, rephrase, or slightly adapt the story to make it short-worthy and engaging, while preserving the core meaning and emotion. Do NOT use any SSML tags. Just return plain text with natural storytelling. Maintain a bright, expressive tone with humor, warmth, and curiosity, ensuring the narration feels lively and shareable.`;

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

Convert SRT subtitles into image generation prompts.

Output must be a valid JSON array of strings.

One image per subtitle index.

Never merge or skip subtitle numbers.

Each string must begin with:
"Generate image X: ..."

All prompts must be written in English.

CRITICAL RULES:

The image model is stateless.

Never use phrases like "same character", "previous scene", "as before".

Every prompt must fully describe characters again.

Maintain visual continuity by repeating defining traits in each prompt.

Always include:

Character physical traits

Clothing details

Environment

Lighting

Mood

Art style

Portrait 9:16 format

No text in image

Style Guidelines:

Bright Indian children's book illustration

North Indian village context

Warm sunlight

Rounded shapes

Cheerful vibrant palette

Safe for ages 3-7

No graphic violence

Do not explain anything.
Do not add commentary.
Only output the JSON array.`;

async function getProjectDir(projectId) {
  const dir = path.join(STORAGE_ROOT, 'projects', projectId);
  await fsPromises.mkdir(dir, { recursive: true });
  return dir;
}

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/models', (req, res) => {
  res.json({ models: AVAILABLE_MODELS, default: DEFAULT_MODEL });
});

app.get('/api/project/:projectId', async (req, res) => {
  try {
    const projectDir = await getProjectDir(req.params.projectId);
    const inputPath = path.join(projectDir, 'input.txt');
    const storyPath = path.join(projectDir, 'story.txt');
    const audioPath = path.join(projectDir, 'audio.wav');
    const subtitlePath = path.join(projectDir, 'subtitle.srt');
    const imagePromptsPath = path.join(projectDir, 'image-prompts.json');
    const ytMetadataPath = path.join(projectDir, 'yt-metadata.txt');

    let data = { projectId: req.params.projectId };

    try { data.input = await fsPromises.readFile(inputPath, 'utf8'); } catch { }
    try { data.story = await fsPromises.readFile(storyPath, 'utf8'); } catch { }
    try { data.audio = await fsPromises.readFile(audioPath, 'base64'); } catch { }
    try { data.subtitle = await fsPromises.readFile(subtitlePath, 'utf8'); } catch { }
    try { data.imagePrompts = await fsPromises.readFile(imagePromptsPath, 'utf8'); } catch { }
    try { data.ytMetadata = await fsPromises.readFile(ytMetadataPath, 'utf8'); } catch { }

    res.json({ success: true, data });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/project/:projectId/input', async (req, res) => {
  try {
    const { content } = req.body;
    const projectDir = await getProjectDir(req.params.projectId);
    await fsPromises.writeFile(path.join(projectDir, 'input.txt'), content || '');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/project/:projectId/story', async (req, res) => {
  try {
    const { content } = req.body;
    const projectDir = await getProjectDir(req.params.projectId);
    await fsPromises.writeFile(path.join(projectDir, 'story.txt'), content || '');
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/project/:projectId/audio', async (req, res) => {
  try {
    const { content } = req.body;
    const projectDir = await getProjectDir(req.params.projectId);
    if (content) {
      await fsPromises.writeFile(path.join(projectDir, 'audio.wav'), content, 'base64');
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/project/:projectId/subtitle', async (req, res) => {
  try {
    const { content } = req.body;
    const projectDir = await getProjectDir(req.params.projectId);
    if (content) {
      await fsPromises.writeFile(path.join(projectDir, 'subtitle.srt'), content);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/project/:projectId/image-prompts', async (req, res) => {
  try {
    const { content } = req.body;
    const projectDir = await getProjectDir(req.params.projectId);
    if (content) {
      await fsPromises.writeFile(path.join(projectDir, 'image-prompts.json'), content);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/project/:projectId/yt-metadata', async (req, res) => {
  try {
    const { content } = req.body;
    const projectDir = await getProjectDir(req.params.projectId);
    if (content) {
      await fsPromises.writeFile(path.join(projectDir, 'yt-metadata.txt'), content);
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/generate', async (req, res) => {
  const { story, model, ssml } = req.body;
  if (!story) {
    return res.status(400).json({ success: false, error: 'Story is required' });
  }

  const selectedModel = model || DEFAULT_MODEL;
  if (!selectedModel) {
    return res.status(400).json({ success: false, error: 'No model selected' });
  }

  const systemPrompt = ssml ? SYSTEM_PROMPT_SSML : SYSTEM_PROMPT_NO_SSML;

  try {
    const result = await generateText({
      model: openrouter.chat(selectedModel),
      system: systemPrompt,
      prompt: story,
    });

    res.json({ success: true, output: result.text.trim() });
  } catch (error) {
    console.error('Error generating story:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/tts', async (req, res) => {
  const { text, speaker, language } = req.body;

  if (!text) {
    return res.status(400).json({ success: false, error: 'Text is required' });
  }

  if (!sarvamClient) {
    return res.status(400).json({ success: false, error: 'SARVAM_API_KEY not configured' });
  }

  try {
    const response = await sarvamClient.textToSpeech.convert({
      text,
      target_language_code: language || 'hi-IN',
      speaker: speaker || 'shubh',
      model: 'bulbul:v3',
      speech_sample_rate: 24000,
      audio_format: 'wav'
    });

    res.json({
      success: true,
      audio: response?.audios?.[0] || null,
      request_id: response?.request_id
    });
  } catch (error) {
    console.error('Error generating TTS:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

function vttToSrt(vtt) {
  let srt = vtt.replace(/WEBVTT\n\n/, '');
  let index = 1;
  srt = srt.replace(/(\d{2}:\d{2}:\d{2})\.(\d{3})/g, (match, time, ms) => {
    return `${time},${ms}`;
  });
  srt = srt.replace(/\n\n/g, (match) => `\n${index++}\n`);
  return srt;
}

app.post('/api/subtitle', async (req, res) => {
  const { audio } = req.body;

  if (!audio) {
    return res.status(400).json({ success: false, error: 'Audio is required' });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(400).json({ success: false, error: 'OPENAI_API_KEY not configured' });
  }

  try {
    const tempDir = path.join(__dirname, 'temp');
    await fsPromises.mkdir(tempDir, { recursive: true });
    const tempFile = path.join(tempDir, `audio_${Date.now()}.wav`);

    await fsPromises.writeFile(tempFile, audio, 'base64');

    const transcription = await openai.audio.transcriptions.create({
      file: fs.createReadStream(tempFile),
      model: 'whisper-1',
      language: 'hi',
      response_format: 'vtt'
    });

    await fsPromises.unlink(tempFile);

    const srt = vttToSrt(transcription);

    res.json({
      success: true,
      subtitle: srt
    });
  } catch (error) {
    console.error('Error generating subtitle:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/image-prompts', async (req, res) => {
  const { subtitle } = req.body;

  if (!subtitle) {
    return res.status(400).json({ success: false, error: 'Subtitle (SRT) is required' });
  }

  const selectedModel = DEFAULT_MODEL;
  if (!selectedModel) {
    return res.status(400).json({ success: false, error: 'No model selected' });
  }

  try {
    const result = await generateText({
      model: openrouter.chat(selectedModel),
      system: SYSTEM_PROMPT_IMAGE,
      prompt: subtitle,
    });

    res.json({ success: true, prompts: result.text.trim() });
  } catch (error) {
    console.error('Error generating image prompts:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/youtube-metadata', async (req, res) => {
  const { story, subtitle } = req.body;

  if (!story && !subtitle) {
    return res.status(400).json({ success: false, error: 'Story or subtitle is required' });
  }

  const selectedModel = DEFAULT_MODEL;
  if (!selectedModel) {
    return res.status(400).json({ success: false, error: 'No model selected' });
  }

  try {
    const input = story || subtitle;
    const result = await generateText({
      model: openrouter.chat(selectedModel),
      system: SYSTEM_PROMPT_YT,
      prompt: input,
    });

    res.json({ success: true, output: result.text.trim() });
  } catch (error) {
    console.error('Error generating YouTube metadata:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/generate-images', async (req, res) => {
  const { projectId, provider } = req.body;

  if (!projectId) {
    return res.status(400).json({ success: false, error: 'Project ID is required' });
  }

  if (provider === 'openrouter' || !COMFY_URL) {
    return res.redirect(`/api/generate-images-openrouter?projectId=${projectId}`);
  }

  const client = await getComfyClient();
  if (!client) {
    return res.status(400).json({ success: false, error: 'COMFY_URL not configured and no openrouter fallback' });
  }

  try {
    try {
      await fetch(`${COMFY_URL}/queue`);
      console.log('ComfyUI connection verified');
    } catch (connErr) {
      console.error('ComfyUI connection test failed:', connErr.message);
    }

    const projectDir = await getProjectDir(projectId);
    const promptsPath = path.join(projectDir, 'image-prompts.json');
    const imageDir = path.join(projectDir, 'images');

    await fsPromises.mkdir(imageDir, { recursive: true });

    const promptsContent = await fsPromises.readFile(promptsPath, 'utf8');
    let prompts;
    try {
      prompts = JSON.parse(promptsContent);
    } catch {
      const match = promptsContent.match(/\[[\s\S]*\]/);
      if (match) {
        prompts = JSON.parse(match[0]);
      } else {
        throw new Error('Invalid prompts format');
      }
    }

    const existingFiles = await fsPromises.readdir(imageDir);
    const completedCount = existingFiles.filter(f => f.endsWith('.png')).length;

    const startIndex = completedCount;
    const totalCount = prompts.length;

    if (startIndex >= totalCount) {
      return res.json({
        success: true,
        message: 'All images already generated',
        completed: totalCount,
        total: totalCount
      });
    }

    console.log(`Generating images ${startIndex + 1} to ${totalCount} via ComfyUI...`);

    for (let i = startIndex; i < totalCount; i++) {
      const prompt = prompts[i];
      console.log(`Generating image ${i + 1}/${totalCount}`);

      try {
        const result = await client.generateImage({
          workflow: COMFY_WORKFLOW,
          inputs: {
            prompt: prompt,
            height: 922,
            width: 512,
          },
          output: {
            type: 'base64',
          },
        });

        if (result.images && result.images[0] && result.images[0].base64) {
          const base64Data = result.images[0].base64.split(',')[1];
          const outputPath = path.join(imageDir, `${i + 1}.png`);
          await fsPromises.writeFile(outputPath, base64Data, 'base64');
          console.log(`Image ${i + 1} saved to ${outputPath}`);
        } else {
          console.log(`Image ${i + 1} result:`, JSON.stringify(result).substring(0, 200));
        }
      } catch (err) {
        console.error(`Error generating image ${i + 1}:`, err.message);
        return res.status(500).json({
          success: false,
          error: `Failed at image ${i + 1}: ${err.message}`,
          completed: i,
          total: totalCount
        });
      }
    }

    res.json({
      success: true,
      completed: totalCount,
      total: totalCount
    });
  } catch (error) {
    console.error('Error generating images:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/generate-images-openrouter', async (req, res) => {
  const { projectId } = req.body;

  if (!projectId) {
    return res.status(400).json({ success: false, error: 'Project ID is required' });
  }

  if (!process.env.OPENROUTER_API_KEY) {
    return res.status(400).json({ success: false, error: 'OPENROUTER_API_KEY not configured' });
  }

  try {
    const projectDir = await getProjectDir(projectId);
    const promptsPath = path.join(projectDir, 'image-prompts.json');
    const imageDir = path.join(projectDir, 'images');

    await fsPromises.mkdir(imageDir, { recursive: true });

    const promptsContent = await fsPromises.readFile(promptsPath, 'utf8');
    let prompts;
    try {
      prompts = JSON.parse(promptsContent);
    } catch {
      const match = promptsContent.match(/\[[\s\S]*\]/);
      if (match) {
        prompts = JSON.parse(match[0]);
      } else {
        throw new Error('Invalid prompts format');
      }
    }

    const existingFiles = await fsPromises.readdir(imageDir);
    const completedCount = existingFiles.filter(f => f.endsWith('.png')).length;

    const startIndex = completedCount;
    const totalCount = prompts.length;

    if (startIndex >= totalCount) {
      return res.json({
        success: true,
        message: 'All images already generated',
        completed: totalCount,
        total: totalCount
      });
    }

    console.log(`Generating images ${startIndex + 1} to ${totalCount} via OpenRouter...`);

    const imageModel = 'sourceful/riverflow-v2-fast';

    for (let i = startIndex; i < totalCount; i++) {
      const prompt = prompts[i];
      console.log(`Generating image ${i + 1}/${totalCount}`);

      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'HTTP-Referer': 'http://localhost:3000',
            'X-Title': 'StoryGenerator'
          },
          body: JSON.stringify({
            model: imageModel,
            messages: [
              { role: 'user', content: prompt }
            ],
            modalities: ['image']
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`API error: ${response.status} - ${errorText}`);
        }

        const data = await response.json();
        const message = data.choices?.[0]?.message;

        const imageUrl = message?.images?.[0]?.image_url?.url;
        if (imageUrl) {
          const base64Data = imageUrl.includes(',') ? imageUrl.split(',')[1] : imageUrl;
          const outputPath = path.join(imageDir, `${i + 1}.png`);
          await fsPromises.writeFile(outputPath, base64Data, 'base64');
          console.log(`Image ${i + 1} saved to ${outputPath}`);
        } else {
          console.log(`Image ${i + 1} result:`, JSON.stringify(data).substring(0, 500));
          throw new Error('No image in response');
        }
      } catch (err) {
        console.error(`Error generating image ${i + 1}:`, err.message);
        return res.status(500).json({
          success: false,
          error: `Failed at image ${i + 1}: ${err.message}`,
          completed: i,
          total: totalCount
        });
      }
    }

    res.json({
      success: true,
      completed: totalCount,
      total: totalCount
    });
  } catch (error) {
    console.error('Error generating images:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/project/:projectId/images-status', async (req, res) => {
  try {
    const projectDir = await getProjectDir(req.params.projectId);
    const imageDir = path.join(projectDir, 'images');

    await fsPromises.mkdir(imageDir, { recursive: true });

    const promptsPath = path.join(projectDir, 'image-prompts.json');
    let total = 0;
    try {
      const promptsContent = await fsPromises.readFile(promptsPath, 'utf8');
      const prompts = JSON.parse(promptsContent);
      total = Array.isArray(prompts) ? prompts.length : 0;
    } catch { }

    const existingFiles = await fsPromises.readdir(imageDir);
    const completed = existingFiles.filter(f => f.endsWith('.png')).length;
    const images = existingFiles.filter(f => f.endsWith('.png')).map(f => ({
      filename: f,
      url: `/api/project/${req.params.projectId}/images/${f}`
    }));

    res.json({
      success: true,
      completed,
      total,
      images
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/project/:projectId/images/:filename', async (req, res) => {
  try {
    const projectDir = await getProjectDir(req.params.projectId);
    const imagePath = path.resolve(projectDir, 'images', req.params.filename);

    await fsPromises.access(imagePath);

    res.sendFile(imagePath);
  } catch (error) {
    console.error('Image error:', error.message);
    res.status(404).send('Not found');
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/story', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'story.html'));
});

// Video Generation Functions
const FPS = 60;
const TARGET_SIZE = { width: 1080, height: 1920 };
const CROSSFADE_DURATION = 0.3;
const ZOOM_RATE = 0.08;

function parseSRT(data) {
  const segments = [];
  const regex = /(\d{1,2}:\d{2}:\d{2}[.,]\d{3}) --> (\d{1,2}:\d{2}:\d{2}[.,]\d{3})/g;
  let match;
  const lines = data.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();
    const timeMatch = line.match(/(\d{1,2}:\d{2}:\d{2}[.,]\d{3}) --> (\d{1,2}:\d{2}:\d{2}[.,]\d{3})/);
    if (timeMatch) {
      const textLines = [];
      i++;
      while (i < lines.length) {
        const nextLine = lines[i].trim();
        if (!nextLine || /^\d+$/.test(nextLine)) {
          i++;
          continue;
        }
        if (/^\d{1,2}:\d{2}:\d{2}[.,]\d{3} --> \d{1,2}:\d{2}:\d{2}[.,]\d{3}/.test(nextLine)) {
          break;
        }
        textLines.push(nextLine);
        i++;
      }
      segments.push({
        startTime: timeMatch[1].replace(',', '.'),
        endTime: timeMatch[2].replace(',', '.'),
        text: textLines.join(' '),
      });
    } else {
      i++;
    }
  }
  return segments;
}

function srtTimeToMs(timeStr) {
  const parts = timeStr.split(':');
  const [h, m, s] = parts;
  const sec = s.split('.');
  return (parseInt(h) * 3600 + parseInt(m) * 60 + parseInt(sec[0])) * 1000 + parseInt(sec[1]);
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
  if (index < totalScenes - 1) fadeFilters.push(`fade=t=out:st=${Math.max(0, duration - CROSSFADE_DURATION)}:d=${CROSSFADE_DURATION}`);

  let filters = [scaleCropFilter, zoomFilter];
  if (fadeFilters.length > 0) filters = filters.concat(fadeFilters);

  const imagePath = scene.image;

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(imagePath)
      .inputOptions(['-loop', '1', '-framerate', FPS.toString()])
      .videoFilters(filters.join(','))
      .outputOptions([
        '-t', duration.toFixed(6),
        '-pix_fmt', 'yuv420p',
        '-c:v', 'libx264',
        '-preset', 'medium',
        '-crf', '23',
        '-r', FPS.toString(),
        '-vsync', 'cfr',
        '-g', Math.round(FPS).toString(),
        '-fps_mode', 'cfr',
      ])
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .run();
  });
}

async function concatenateClips(clipPaths, tempDir, outputPath) {
  const concatPath = path.join(tempDir, 'concat.txt');
  const content = clipPaths.map(p => `file '${p}'`).join('\n');
  fs.writeFileSync(concatPath, content);

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(concatPath)
      .inputOptions(['-f', 'concat', '-safe', '0'])
      .outputOptions([
        '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p',
        '-preset', 'medium',
        '-crf', '23',
        '-r', FPS.toString(),
        '-vsync', 'cfr',
      ])
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .run();
  });
}

async function addAudio(videoPath, audioPath, outputPath) {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(videoPath)
      .input(audioPath)
      .outputOptions([
        '-c:v', 'copy',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-map', '0:v:0',
        '-map', '1:a:0',
        '-shortest',
      ])
      .output(outputPath)
      .on('end', () => resolve(outputPath))
      .on('error', (err) => reject(err))
      .run();
  });
}

async function createStoryVideo(projectId, onProgress) {
  const projectDir = await getProjectDir(projectId);
  const imageDir = path.join(projectDir, 'images');
  const audioPath = path.join(projectDir, 'audio.wav');
  const srtPath = path.join(projectDir, 'subtitle.srt');
  const outputPath = path.join(projectDir, 'video.mp4');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'story-video-'));

  console.log('Video temp dir:', tempDir);

  try {
    const srtContent = fs.readFileSync(srtPath, 'utf8');
    console.log('SRT content length:', srtContent.length);
    const srtData = parseSRT(srtContent);
    console.log('Parsed SRT segments:', srtData.length);
    const images = fs.readdirSync(imageDir).filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    console.log('Found images:', images.length);

    const scenesData = srtData.map((item, index) => {
      let start_ms = srtTimeToMs(item.startTime);
      let end_ms = index < srtData.length - 1 ? srtTimeToMs(srtData[index + 1].startTime) : srtTimeToMs(item.endTime) + 3000;
      if (index === 0 && start_ms > 0) start_ms = 0;
      return {
        image: path.join(imageDir, images[index] || images[images.length - 1]),
        start_ms,
        end_ms,
        text: item.text,
      };
    });

    onProgress({ status: 'clipping', message: `Creating ${scenesData.length} clips...` });

    const clipPaths = [];
    for (let i = 0; i < scenesData.length; i++) {
      const clipPath = await createImageClip(scenesData[i], i, scenesData.length, tempDir, imageDir);
      clipPaths.push(clipPath);
    }

    onProgress({ status: 'concatenating', message: 'Merging clips...' });

    const tempVideo = path.join(tempDir, 'temp_concatenated.mp4');
    await concatenateClips(clipPaths, tempDir, tempVideo);

    onProgress({ status: 'audio', message: 'Adding audio...' });

    if (!fs.existsSync(audioPath)) throw new Error('Audio file not found');
    await addAudio(tempVideo, audioPath, outputPath);

    fs.rmSync(tempDir, { recursive: true, force: true });

    onProgress({ status: 'done', message: 'Video created!', progress: 100 });
    return outputPath;
  } catch (error) {
    if (fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
    throw error;
  }
}

// Video generation endpoint
app.post('/api/generate-video', async (req, res) => {
  const { projectId } = req.body;

  if (!projectId) {
    return res.status(400).json({ success: false, error: 'Project ID is required' });
  }

  try {
    const projectDir = await getProjectDir(projectId);
    const audioPath = path.join(projectDir, 'audio.wav');
    const srtPath = path.join(projectDir, 'subtitle.srt');
    const imageDir = path.join(projectDir, 'images');

    if (!fs.existsSync(audioPath)) return res.status(400).json({ success: false, error: 'Audio not found' });
    if (!fs.existsSync(srtPath)) return res.status(400).json({ success: false, error: 'Subtitle not found' });
    if (!fs.existsSync(imageDir)) return res.status(400).json({ success: false, error: 'Images not found' });

    const images = fs.readdirSync(imageDir).filter(f => f.endsWith('.png'));
    if (images.length === 0) return res.status(400).json({ success: false, error: 'No images found' });

    const outputPath = await createStoryVideo(projectId, (progress) => {
      console.log('Video generation:', progress.message);
    });

    res.json({ success: true, videoUrl: `/api/project/${projectId}/video` });
  } catch (error) {
    console.error('Video generation error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/project/:projectId/video', async (req, res) => {
  try {
    const projectDir = await getProjectDir(req.params.projectId);
    const videoPath = path.join(projectDir, 'video.mp4');
    await fsPromises.access(videoPath);
    res.sendFile(videoPath);
  } catch (error) {
    res.status(404).send('Video not found');
  }
});

app.get('/api/project/:projectId/video-status', async (req, res) => {
  try {
    const projectDir = await getProjectDir(req.params.projectId);
    const videoPath = path.join(projectDir, 'video.mp4');
    const exists = fs.existsSync(videoPath);
    res.json({ success: true, exists, videoUrl: exists ? `/api/project/${req.params.projectId}/video` : null });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});