import fs from 'node:fs';
import path from 'node:path';

// Parses the yt-metadata.txt format:
//   TITLES:
//   - title one
//   - title two
//   - title three
//
//   DESCRIPTION:
//   <free-form text, may span multiple lines>
//
//   HASHTAGS:
//   #tag1 #tag2 #tag3
//
//   TAGS:
//   tag1, tag2, tag3
export function parseYtMetadata(text) {
  const titles = [];
  let description = '';
  let hashtags = '';
  let tags = '';

  const lines = text.split(/\r?\n/);
  let section = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (/^TITLES:\s*$/.test(line)) {
      section = 'titles';
      continue;
    }
    if (/^DESCRIPTION:\s*$/.test(line)) {
      section = 'description';
      continue;
    }
    if (/^HASHTAGS:\s*$/.test(line)) {
      section = 'hashtags';
      continue;
    }
    if (/^TAGS:\s*$/.test(line)) {
      section = 'tags';
      continue;
    }
    if (!line) continue;

    switch (section) {
      case 'titles':
        if (line.startsWith('-')) titles.push(line.slice(1).trim());
        break;
      case 'description':
        description += (description ? '\n' : '') + rawLine.trim();
        break;
      case 'hashtags':
        hashtags += (hashtags ? ' ' : '') + line;
        break;
      case 'tags':
        tags += (tags ? ', ' : '') + line.replace(/^,\s*|,\s*$/g, '');
        break;
    }
  }

  return {
    titles: titles.filter(Boolean),
    description: description.trim(),
    hashtags: hashtags.trim(),
    tags: tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
  };
}

// Resolves a project dir (name or path) and loads its metadata + video.
export function loadProject(projectRef, projectsRoot) {
  let dir = projectRef;
  if (!path.isAbsolute(dir)) dir = path.join(projectsRoot, dir);
  dir = path.resolve(dir);

  const metadataPath = path.join(dir, 'yt-metadata.txt');
  const videoPath = path.join(dir, 'video.mp4');

  if (!fs.existsSync(metadataPath)) {
    throw new Error(`yt-metadata.txt not found in ${dir}`);
  }
  if (!fs.existsSync(videoPath)) {
    throw new Error(`video.mp4 not found in ${dir}`);
  }

  const metadata = parseYtMetadata(fs.readFileSync(metadataPath, 'utf8'));
  if (metadata.titles.length === 0) {
    throw new Error(`No titles found in ${metadataPath}`);
  }

  return { dir, videoPath, metadata };
}
