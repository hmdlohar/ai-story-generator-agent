import {createOpenAI} from '@ai-sdk/openai';
import {generateText} from 'ai';
import dotenv from 'dotenv';

dotenv.config();

const defaultModel = process.env.OPENROUTER_MODEL || 'x-ai/grok-4.3';

const openrouter = createOpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
  headers: {
    'X-Title': 'Story-Gen SEO Writer',
  },
});

/**
 * Generates plain-text SEO copy for short-video uploads.
 *
 * @param {string[]} storyLines - Compressed story lines or dialogs.
 * @returns {Promise<string>}
 */
export async function generateSeoText(storyLines) {
  if (!Array.isArray(storyLines) || storyLines.length === 0) {
    throw new Error('storyLines must be a non-empty array.');
  }

  const model = openrouter(defaultModel);

  const systemPrompt = `
    You write short-form SEO text for Hindi story reels.

    Input:
    You will receive a short Hindi story as an array of lines.

    Goal:
    Generate a simple plain-text upload block for platforms like YouTube, Instagram, and Facebook.

    Keep it minimal and useful.

    Requirements:
    1. Output must be plain text only.
    2. Do not return JSON.
    3. Do not return markdown fences.
    4. The text must contain exactly these sections in this order:
       Title:
       Description:
       Hashtags:
       YouTube Tags:
    5. Title should be catchy and concise.
    6. Description should be short, natural, and suitable for upload.
    7. Hashtags should be space-separated on one line.
    8. YouTube Tags should be comma-separated on one line.
    9. Keep the content relevant to the story, moral, and Hindi short-video audience.
    10. Avoid clickbait that misrepresents the story.
  `;

  const prompt = `इन हिंदी स्टोरी लाइनों के लिए SEO text बनाओ:\n\n${storyLines
    .map((line, index) => `${index + 1}. ${line}`)
    .join('\n')}`;

  try {
    const {text} = await generateText({
      model,
      system: systemPrompt,
      prompt,
    });

    return text.trim();
  } catch (error) {
    console.error('Error generating SEO text:', error);
    throw error;
  }
}
