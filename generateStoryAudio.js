import fs from 'node:fs/promises';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

const defaultApiUrl = process.env.STORY_TTS_API_URL;

const filePathToBase64 = async (filePath) => {
  const buffer = await fs.readFile(filePath);
  return buffer.toString('base64');
};

const ensureDir = async (dirPath) => {
  await fs.mkdir(dirPath, {recursive: true});
};

const getStoryTtsEndpoint = (apiUrl) => {
  const normalizedBase = apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`;
  return new URL('generate-story-audio', normalizedBase).toString();
};

/**
 * Calls the story TTS server, saves the generated WAV and transcript JSON,
 * and returns both the API response and saved file paths.
 *
 * @param {Object} params
 * @param {string[]} params.storySentences - Story lines to synthesize.
 * @param {string} params.referenceAudioPath - Reference audio file path.
 * @param {string} params.referenceTranscript - Transcript matching the reference audio.
 * @param {string} params.outputDir - Directory to save generated files in.
 * @param {string} [params.apiUrl] - Override for the TTS endpoint.
 * @param {string} [params.audioFileName='final_story.wav'] - Output WAV filename.
 * @param {string} [params.transcriptFileName='final_story_transcript.json'] - Output transcript filename.
 * @param {number} [params.pauseMs=350]
 * @param {number} [params.cfg=2.8]
 * @param {number} [params.steps=15]
 * @param {number} [params.seed=-1]
 * @param {boolean} [params.locked=false]
 * @returns {Promise<{
 *   audioPath: string,
 *   transcriptPath: string,
 *   transcript: Array<{start: number, end: number, text: string}>,
 *   response: any
 * }>}
 */
export async function generateStoryAudio({
  storySentences,
  referenceAudioPath,
  referenceTranscript,
  outputDir,
  apiUrl = defaultApiUrl,
  audioFileName = 'final_story.wav',
  transcriptFileName = 'final_story_transcript.json',
  pauseMs = 350,
  cfg = 2.8,
  steps = 15,
  seed = -1,
  locked = false,
}) {
  if (!apiUrl) {
    throw new Error(
      'Missing TTS API URL. Pass apiUrl or set STORY_TTS_API_URL in .env.',
    );
  }

  if (!Array.isArray(storySentences) || storySentences.length === 0) {
    throw new Error('storySentences must be a non-empty array.');
  }

  if (!referenceAudioPath) {
    throw new Error('referenceAudioPath is required.');
  }

  if (!referenceTranscript) {
    throw new Error('referenceTranscript is required.');
  }

  if (!outputDir) {
    throw new Error('outputDir is required.');
  }

  const referenceAudioBase64 = await filePathToBase64(referenceAudioPath);
  const endpoint = getStoryTtsEndpoint(apiUrl);

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      reference_audio_base64: referenceAudioBase64,
      reference_transcript: referenceTranscript,
      story_sentences: storySentences,
      pause_ms: pauseMs,
      cfg,
      steps,
      seed,
      locked,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(
      `Story TTS request failed with ${res.status}: ${errorText}`,
    );
  }

  const data = await res.json();

  if (!data.audio_base64) {
    throw new Error('Story TTS response did not include audio_base64.');
  }

  if (!data.transcript) {
    throw new Error('Story TTS response did not include transcript.');
  }

  await ensureDir(outputDir);

  const audioPath = path.join(outputDir, audioFileName);
  const transcriptPath = path.join(outputDir, transcriptFileName);
  const audioBuffer = Buffer.from(data.audio_base64, 'base64');

  await fs.writeFile(audioPath, audioBuffer);
  await fs.writeFile(
    transcriptPath,
    `${JSON.stringify(data.transcript, null, 2)}\n`,
    'utf8',
  );

  return {
    audioPath,
    transcriptPath,
    transcript: data.transcript,
    response: data,
  };
}

// Example usage:
/*
const story = [
  'एक गांव जंगल के पास था।',
  'लोग लकड़ी काटकर शहर में बेचते थे।',
  'जंगल में जंगली जानवरों का खतरा था।',
];

generateStoryAudio({
  storySentences: story,
  referenceAudioPath: '/path/to/reference.wav',
  referenceTranscript: 'एक बहुत कंजूस आदमी के घर अचानक कई मेहमान आ गए।',
  outputDir: 'output/story_audio',
}).then((result) => {
  console.log(result.audioPath);
  console.log(result.transcriptPath);
});
*/
