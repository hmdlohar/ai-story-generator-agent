import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import dotenv from 'dotenv';
import {generateStoryDialogs} from '../generateStoryDialogs.js';
import {generateStoryAudio} from '../generateStoryAudio.js';
import {generateSeoText} from '../generateSeoText.js';
import {
  generateOrLoadImagePrompts,
  generateStoryImages,
} from '../storyGenerate.js';

dotenv.config();

const args = process.argv.slice(2);

const DEFAULT_REFERENCE_AUDIO_PATH =
  '/media/hyper2/HYPER8/yt/reels/reel1/audio.mp3';
const DEFAULT_REFERENCE_TRANSCRIPT =
  'एक बहुत कंजूस आदमी के घर अचानक कई मेहमान आ गए। अब कंजूस सोच में पड़ गया कि यह लोग तो एक ही दिन में मेरे पूरे महीने का राशन साफ कर देंगे';
const DEFAULT_BROWSER_EXECUTABLE = '/usr/bin/google-chrome';
const DEFAULT_PORT = '3030';

const getArgValue = (name) => {
  const prefix = `${name}=`;
  const direct = args.find((arg) => arg.startsWith(prefix));
  if (direct) {
    return direct.slice(prefix.length);
  }

  const index = args.indexOf(name);
  if (index !== -1 && index + 1 < args.length) {
    return args[index + 1];
  }

  return null;
};

const hasFlag = (name) => args.includes(name);

const projectSlug = getArgValue('--project-slug');
const storyInline = getArgValue('--story');
const storyFile = getArgValue('--story-file');
const referenceAudioPath =
  getArgValue('--reference-audio-path') ?? DEFAULT_REFERENCE_AUDIO_PATH;
const referenceTranscript =
  getArgValue('--reference-transcript') ?? DEFAULT_REFERENCE_TRANSCRIPT;
const browserExecutable =
  getArgValue('--browser-executable') ?? DEFAULT_BROWSER_EXECUTABLE;
const port = getArgValue('--port') ?? DEFAULT_PORT;
const noStudio = hasFlag('--no-studio');
const renderVideo = hasFlag('--render');

const pauseMs = getArgValue('--pause-ms');
const cfg = getArgValue('--cfg');
const steps = getArgValue('--steps');
const seed = getArgValue('--seed');
const locked = hasFlag('--locked');

const cwd = process.cwd();
const now = () => new Date().toISOString();
const log = (message) => console.log(`[${now()}] ${message}`);

const failUsage = (message) => {
  console.error(message);
  console.error(`
Usage:
  npm run story:preview -- --project-slug <slug> --story-file <path> --reference-audio-path <path> --reference-transcript "<text>"

Optional:
  --story "<full hindi story>"
  --browser-executable /usr/bin/google-chrome
  --port 3030
  --render
  --pause-ms 350
  --cfg 2.8
  --steps 15
  --seed -1
  --locked
  --no-studio
`);
  process.exit(1);
};

if (!projectSlug) {
  failUsage('Missing --project-slug');
}

if (!storyInline && !storyFile) {
  failUsage('Provide either --story or --story-file');
}

const readJsonIfExists = async (targetPath) => {
  try {
    const content = await fs.readFile(targetPath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  }
};

const fileExists = async (targetPath) => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, {recursive: true});
};

const readStoryInput = async () => {
  if (storyInline) {
    return storyInline.trim();
  }

  const content = await fs.readFile(path.resolve(cwd, storyFile), 'utf8');
  return content.trim();
};

const normalizeNumber = (value, fallback) => {
  if (value == null) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric value: ${value}`);
  }

  return parsed;
};

const getDurationFromSegments = (segments) => {
  if (!Array.isArray(segments) || segments.length === 0) {
    return 0;
  }

  return Math.max(...segments.map((segment) => segment.end)) / 1000;
};

const writeJson = async (targetPath, value) => {
  await ensureDir(path.dirname(targetPath));
  await fs.writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

const spawnCommand = (command, commandArgs, extraEnv = {}) => {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: 'inherit',
      cwd,
      env: {
        ...process.env,
        ...extraEnv,
      },
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${commandArgs.join(' ')} exited with code ${code}`));
    });
  });
};

const main = async () => {
  const storyText = await readStoryInput();
  const projectRoot = path.join(cwd, 'output', 'projects', projectSlug);
  const inputDir = path.join(projectRoot, 'input');
  const dialogsDir = path.join(projectRoot, 'dialogs');
  const audioDir = path.join(projectRoot, 'audio');
  const imagesDir = path.join(projectRoot, 'images');
  const seoDir = path.join(projectRoot, 'seo');
  const remotionDir = path.join(projectRoot, 'remotion');

  const storyTextPath = path.join(inputDir, 'story.txt');
  const dialogsPath = path.join(dialogsDir, 'dialogs.json');
  const audioPath = path.join(audioDir, 'final_story.wav');
  const transcriptPath = path.join(audioDir, 'final_story_transcript.json');
  const imagePromptsPath = path.join(imagesDir, 'image-prompts.json');
  const seoTextPath = path.join(seoDir, 'seo.txt');
  const remotionStoryPath = path.join(remotionDir, 'story.json');
  const renderOutputPath = path.join(remotionDir, 'story.mp4');

  const existingStoryText = await fs.readFile(storyTextPath, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') {
      return null;
    }

    throw error;
  });

  if (existingStoryText != null && existingStoryText.trim() !== storyText) {
    const downstreamFiles = [
      dialogsPath,
      audioPath,
      transcriptPath,
      imagePromptsPath,
      seoTextPath,
      remotionStoryPath,
    ];
    const downstreamExists = await Promise.all(downstreamFiles.map(fileExists));

    if (downstreamExists.some(Boolean)) {
      throw new Error(
        `Project "${projectSlug}" already contains generated assets for a different story. Use a new slug or delete that project's generated files first.`,
      );
    }
  }

  await ensureDir(inputDir);
  await fs.writeFile(storyTextPath, `${storyText}\n`, 'utf8');
  log(`Project: ${projectSlug}`);
  log(`Project root: ${projectRoot}`);
  log(`Saved story input to ${storyTextPath}`);

  let dialogs = await readJsonIfExists(dialogsPath);
  if (Array.isArray(dialogs) && dialogs.length > 0) {
    log(`Step 1/6: Reusing dialogs from ${dialogsPath}`);
  } else {
    log('Step 1/6: Generating compressed story dialogs...');
    dialogs = await generateStoryDialogs(storyText);
    await writeJson(dialogsPath, dialogs);
    log(`Saved dialogs to ${dialogsPath}`);
  }

  let transcript = await readJsonIfExists(transcriptPath);
  const hasAudio = await fileExists(audioPath);
  if (hasAudio && Array.isArray(transcript) && transcript.length > 0) {
    log(`Step 2/6: Reusing audio and transcript from ${audioDir}`);
  } else {
    log('Step 2/6: Generating TTS audio and transcript...');
    const audioResult = await generateStoryAudio({
      storySentences: dialogs,
      referenceAudioPath: path.resolve(cwd, referenceAudioPath),
      referenceTranscript,
      outputDir: audioDir,
      pauseMs: normalizeNumber(pauseMs, 350),
      cfg: normalizeNumber(cfg, 2.8),
      steps: normalizeNumber(steps, 15),
      seed: normalizeNumber(seed, -1),
      locked,
    });
    transcript = audioResult.transcript;
    log(`Saved audio to ${audioResult.audioPath}`);
    log(`Saved transcript to ${audioResult.transcriptPath}`);
  }

  if (!Array.isArray(transcript) || transcript.length === 0) {
    throw new Error('Transcript is missing or invalid after the TTS step.');
  }

  log('Step 3/6: Generating or reusing image prompts...');
  const prompts = await generateOrLoadImagePrompts(transcript, {
    promptsPath: imagePromptsPath,
    log,
  });
  log(`Image prompts ready at ${imagePromptsPath}`);

  log('Step 4/6: Generating or reusing images...');
  const imagePaths = await generateStoryImages(prompts, {
    outputDir: imagesDir,
    log,
  });

  if (await fileExists(seoTextPath)) {
    log(`Step 5/6: Reusing SEO text from ${seoTextPath}`);
  } else {
    log('Step 5/6: Generating SEO text...');
    const seoText = await generateSeoText(dialogs);
    await ensureDir(seoDir);
    await fs.writeFile(seoTextPath, `${seoText}\n`, 'utf8');
    log(`Saved SEO text to ${seoTextPath}`);
  }

  log('Step 6/6: Writing Remotion project config...');
  const remotionStory = {
    title: projectSlug,
    fps: 30,
    width: 1080,
    height: 1920,
    audioPath,
    audioDurationInSeconds: getDurationFromSegments(transcript),
    imagePaths,
    segments: transcript,
  };
  await writeJson(remotionStoryPath, remotionStory);
  log(`Saved Remotion story config to ${remotionStoryPath}`);

  log('Syncing project assets for Remotion...');
  await spawnCommand(
    process.platform === 'win32' ? 'npm.cmd' : 'npm',
    ['run', 'video:sync-assets', '--', '--project-slug', projectSlug],
    {STORY_PROJECT_SLUG: projectSlug},
  );
  log('Remotion assets are ready.');

  if (renderVideo) {
    log('Rendering video instead of launching Studio...');
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const renderArgs = [
      'exec',
      'remotion',
      'render',
      'src/index.jsx',
      'StoryVideo',
      renderOutputPath,
    ];

    if (browserExecutable) {
      renderArgs.push(`--browser-executable=${browserExecutable}`);
    }

    await spawnCommand(npmCommand, renderArgs, {STORY_PROJECT_SLUG: projectSlug});
    log(`Render completed. Output file: ${renderOutputPath}`);
    return;
  }

  if (noStudio) {
    log('Skipping Remotion Studio launch because --no-studio was provided.');
    log(`Run preview later with: STORY_PROJECT_SLUG=${projectSlug} npm run dev:video`);
    return;
  }

  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const studioArgs = ['run', 'dev:video'];

  if (browserExecutable || port) {
    studioArgs.push('--');
    if (browserExecutable) {
      studioArgs.push(`--browser-executable=${browserExecutable}`);
    }
    if (port) {
      studioArgs.push(`--port=${port}`);
    }
  }

  log('Launching Remotion Studio...');
  await spawnCommand(npmCommand, studioArgs, {STORY_PROJECT_SLUG: projectSlug});
};

main().catch((error) => {
  console.error(`[${now()}] Pipeline failed:`, error);
  process.exit(1);
});
