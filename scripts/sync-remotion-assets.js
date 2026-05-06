import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const args = process.argv.slice(2);
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

const projectSlug = getArgValue('--project-slug') ?? process.env.STORY_PROJECT_SLUG;
const storyConfigPath = projectSlug
  ? path.join(projectRoot, 'output', 'projects', projectSlug, 'remotion', 'story.json')
  : path.join(projectRoot, 'data', 'story.json');
const manifestPath = path.join(projectRoot, 'data', 'remotion-manifest.json');
const publicDir = path.join(projectRoot, 'public');
const generatedAssetsDir = path.join(publicDir, 'remotion-assets');
const publicAudioDir = path.join(generatedAssetsDir, 'audio');
const publicImagesDir = path.join(generatedAssetsDir, 'images');

const ensureDir = (dir) => {
  fs.mkdirSync(dir, {recursive: true});
};

const copyFile = (from, to) => {
  ensureDir(path.dirname(to));
  fs.copyFileSync(from, to);
};

const normalizePath = (targetPath) => {
  if (path.isAbsolute(targetPath)) {
    return targetPath;
  }

  return path.resolve(projectRoot, targetPath);
};

const sanitizeFileName = (fileName) => {
  return fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
};

const getDurationFromSegments = (segments) => {
  if (!Array.isArray(segments) || segments.length === 0) {
    return 0;
  }

  const lastSegment = segments.reduce((latest, segment) => {
    return segment.end > latest.end ? segment : latest;
  });

  return lastSegment.end / 1000;
};

if (!fs.existsSync(storyConfigPath)) {
  throw new Error(`Story config not found: ${storyConfigPath}`);
}

const rawStory = JSON.parse(fs.readFileSync(storyConfigPath, 'utf8'));
const sourceAudio = normalizePath(rawStory.audioPath);
const sourceImagePaths = rawStory.imagePaths.map(normalizePath);

if (sourceImagePaths.length === 0) {
  throw new Error('story.json must contain at least one image path.');
}

fs.rmSync(generatedAssetsDir, {recursive: true, force: true});
ensureDir(publicAudioDir);
ensureDir(publicImagesDir);

const audioFileName = `audio/${sanitizeFileName(path.basename(sourceAudio))}`;
copyFile(sourceAudio, path.join(generatedAssetsDir, audioFileName));

const imageFiles = sourceImagePaths.map((imagePath, index) => {
  const fileName = `${String(index + 1).padStart(2, '0')}-${sanitizeFileName(
    path.basename(imagePath),
  )}`;
  const publicFile = `images/${fileName}`;
  copyFile(imagePath, path.join(generatedAssetsDir, publicFile));
  return `remotion-assets/${publicFile}`;
});

const manifest = {
  title: rawStory.title ?? 'StoryVideo',
  fps: rawStory.fps ?? 30,
  width: rawStory.width ?? 1080,
  height: rawStory.height ?? 1920,
  audioFile: `remotion-assets/${audioFileName}`,
  audioDurationInSeconds:
    rawStory.audioDurationInSeconds ?? getDurationFromSegments(rawStory.segments),
  imageFiles,
  segments: rawStory.segments,
};

fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Remotion assets synced using ${storyConfigPath}.`);
