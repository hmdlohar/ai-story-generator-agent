import path from 'path';
import { promises as fs } from 'fs';

export const REMOTION_FPS = 30;
export const REMOTION_WIDTH = 1080;
export const REMOTION_HEIGHT = 1920;

export function getStorageRoot() {
  return path.resolve(process.env.STORAGE_ROOT_DIR || './storage');
}

export function getProjectDir(projectId) {
  return path.join(getStorageRoot(), 'projects', projectId);
}

function srtTimeToMs(timeStr) {
  const [h, m, s] = timeStr.split(':');
  const [sec, ms] = s.replace(',', '.').split('.');
  return (Number(h) * 3600 + Number(m) * 60 + Number(sec)) * 1000 + Number(ms);
}

function parseSRT(data) {
  const segments = [];
  const lines = data.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    const timeMatch = line.match(/(\d{1,2}:\d{2}:\d{2}[.,]\d{3}) --> (\d{1,2}:\d{2}:\d{2}[.,]\d{3})/);

    if (!timeMatch) {
      i++;
      continue;
    }

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
      startMs: srtTimeToMs(timeMatch[1]),
      endMs: srtTimeToMs(timeMatch[2]),
      text: textLines.join(' '),
    });
  }

  return segments;
}

function safeProjectId(projectId) {
  return String(projectId).replace(/[^a-zA-Z0-9_-]/g, '_');
}

async function copyFile(source, destination) {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
}

export async function prepareRemotionProject(projectId) {
  const projectDir = getProjectDir(projectId);
  const imageDir = path.join(projectDir, 'images');
  const srtPath = path.join(projectDir, 'subtitle.srt');
  const audioPath = path.join(projectDir, 'audio.wav');
  const outputPath = path.join(projectDir, 'video.mp4');
  const publicProjectId = safeProjectId(projectId);
  const assetRoot = path.join(process.cwd(), 'public', 'remotion-assets', publicProjectId);
  const publicAssetRoot = `remotion-assets/${publicProjectId}`;

  const [srtContent, imageFiles] = await Promise.all([
    fs.readFile(srtPath, 'utf8'),
    fs.readdir(imageDir),
  ]);

  const images = imageFiles
    .filter((file) => /\.(png|jpe?g|webp)$/i.test(file))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (images.length === 0) {
    throw new Error('No images found for Remotion render');
  }

  await fs.rm(assetRoot, { recursive: true, force: true });
  await fs.mkdir(path.join(assetRoot, 'images'), { recursive: true });

  const copiedImages = [];
  for (const image of images) {
    const source = path.join(imageDir, image);
    const destination = path.join(assetRoot, 'images', image);
    await copyFile(source, destination);
    copiedImages.push(`${publicAssetRoot}/images/${image}`);
  }

  await copyFile(audioPath, path.join(assetRoot, 'audio.wav'));

  const srtSegments = parseSRT(srtContent);
  if (srtSegments.length === 0) {
    throw new Error('No subtitle segments found for Remotion render');
  }

  const scenes = srtSegments.map((segment, index) => {
    const startMs = index === 0 ? 0 : segment.startMs;
    const endMs = index < srtSegments.length - 1
      ? srtSegments[index + 1].startMs
      : segment.endMs + 3000;

    return {
      startMs,
      endMs,
      text: segment.text,
      imageSrc: copiedImages[index] || copiedImages[copiedImages.length - 1],
    };
  });

  const durationMs = Math.max(...scenes.map((scene) => scene.endMs));
  const props = {
    fps: REMOTION_FPS,
    width: REMOTION_WIDTH,
    height: REMOTION_HEIGHT,
    durationMs,
    audioSrc: `${publicAssetRoot}/audio.wav`,
    scenes,
  };

  const propsPath = path.join(projectDir, 'remotion-props.json');
  await fs.writeFile(propsPath, JSON.stringify(props, null, 2));

  return {
    projectDir,
    propsPath,
    outputPath,
    publicAssetRoot,
  };
}
