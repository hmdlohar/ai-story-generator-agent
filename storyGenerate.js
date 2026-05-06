import fs from 'node:fs/promises';
import path from 'node:path';
import {generateImagePrompts} from './generateImagePrompt.js';
import {generateImage} from './generateImage.js';

const fileExists = async (targetPath) => {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
};

export async function generateOrLoadImagePrompts(
  transcript,
  {promptsPath, log = console.log},
) {
  if (!Array.isArray(transcript) || transcript.length === 0) {
    throw new Error('transcript must be a non-empty array.');
  }

  if (!promptsPath) {
    throw new Error('promptsPath is required.');
  }

  await fs.mkdir(path.dirname(promptsPath), {recursive: true});

  let prompts;

  if (await fileExists(promptsPath)) {
    log(`Reusing cached image prompts from ${promptsPath}`);
    prompts = JSON.parse(await fs.readFile(promptsPath, 'utf8'));
  } else {
    log(`Generating ${transcript.length} image prompts...`);
    prompts = await generateImagePrompts(transcript);
    await fs.writeFile(promptsPath, `${JSON.stringify(prompts, null, 2)}\n`, 'utf8');
    log(`Saved image prompts to ${promptsPath}`);
  }

  if (!Array.isArray(prompts) || prompts.length !== transcript.length) {
    throw new Error(
      `Prompt count mismatch. Expected ${transcript.length}, got ${prompts.length}.`,
    );
  }

  return prompts;
}

export async function generateStoryImages(
  prompts,
  {outputDir, log = console.log},
) {
  if (!Array.isArray(prompts) || prompts.length === 0) {
    throw new Error('prompts must be a non-empty array.');
  }

  if (!outputDir) {
    throw new Error('outputDir is required.');
  }

  await fs.mkdir(outputDir, {recursive: true});
  log(`Preparing ${prompts.length} images...`);
  const imagePaths = [];

  for (let i = 0; i < prompts.length; i++) {
    const prompt = prompts[i];
    const filename = `${i + 1}.png`;
    const filePath = path.join(outputDir, filename);
    imagePaths.push(filePath);

    if (await fileExists(filePath)) {
      log(`Skipping image ${i + 1}/${prompts.length}: ${filename} already exists`);
      continue;
    }

    log(`Generating image ${i + 1}/${prompts.length}: ${filename}`);
    await generateImage(prompt, filePath);
  }

  log('Image generation step completed successfully.');
  return imagePaths;
}

/**
 * Orchestrates prompt generation and image generation.
 *
 * @param {Array<{start: number, end: number, text: string}>} transcript
 * @param {Object} options
 * @param {string} options.outputDir
 * @param {string} options.promptsPath
 * @param {(message: string) => void} [options.log=console.log]
 * @returns {Promise<{prompts: string[], imagePaths: string[]}>}
 */
export async function storyGenerate(
  transcript,
  {outputDir, promptsPath, log = console.log},
) {
  try {
    const prompts = await generateOrLoadImagePrompts(transcript, {
      promptsPath,
      log,
    });
    const imagePaths = await generateStoryImages(prompts, {outputDir, log});
    return {prompts, imagePaths};
  } catch (error) {
    console.error('Error in story generation:', error);
    throw error;
  }
}
