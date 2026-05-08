import {createOpenAI} from '@ai-sdk/openai';
import {generateObject} from 'ai';
import {z} from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const defaultModel = process.env.OPENROUTER_MODEL || 'x-ai/grok-4.3';

const openrouter = createOpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
  headers: {
    'X-Title': 'Story-Gen Dialog Compressor',
  },
});

/**
 * Compresses a Hindi story into short Hindi dialog lines suitable for TTS and reels.
 *
 * @param {string} hindiStory - Full Hindi story text.
 * @returns {Promise<string[]>} - Compressed Hindi dialog lines.
 */
export async function generateStoryDialogs(hindiStory) {
  if (!hindiStory || !hindiStory.trim()) {
    throw new Error('hindiStory is required.');
  }

  const model = openrouter(defaultModel);

  const systemPrompt = `
    Rewrite the given Hindi story into short Hindi dialog lines for TTS while keeping the essence of the story.
    The rewritten story must still feel complete from beginning to end.
    Start directly from the story. Do not waste lines on generic intro like "दोस्तों" or "आज की कहानी".
    Each line must be in natural spoken Hindi, in Devanagari, and 60 characters or fewer.
    If a line becomes longer than 60 characters, split it into two or more lines.
    Return a JSON object with a "dialogs" array of strings only.
  `;

  try {
    const {object} = await generateObject({
      model,
      schema: z.object({
        dialogs: z
          .array(
            z
              .string()
              .min(3)
              .describe('One short Hindi spoken line for TTS narration.'),
          )
          .min(4)
          .max(25),
      }),
      system: systemPrompt,
      prompt: `this is your story, write dialogs.
${hindiStory}`,
    });

    return object.dialogs;
  } catch (error) {
    console.error('Error generating story dialogs:', error);
    throw error;
  }
}

// Example usage:
/*
const story = `
एक बहुत कंजूस आदमी के घर अचानक कई मेहमान आ गए।
अब वह सोच में पड़ गया कि ये लोग तो उसका पूरा राशन खत्म कर देंगे।
फिर उसने एक चाल चली।
`;

generateStoryDialogs(story).then((dialogs) => console.log(dialogs));
*/
