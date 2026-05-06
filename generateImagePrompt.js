import { createOpenAI } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const defaultModel = process.env.OPENROUTER_MODEL || 'x-ai/grok-4.3';

// Configure OpenRouter
const openrouter = createOpenAI({
  baseURL: 'https://openrouter.ai/api/v1',
  apiKey: process.env.OPENROUTER_API_KEY,
  headers: {
    'X-Title': 'Story-Gen Prompt Generator', // Optional
  },
});

/**
 * Generates consistent image prompts for a story based on transcript items.
 * 
 * @param {Array<{start: number, end: number, text: string}>} transcriptItems - The transcript items to generate images for.
 * @returns {Promise<string[]>} - An array of detailed image prompts.
 */
export async function generateImagePrompts(transcriptItems) {
  const model = openrouter(defaultModel);

  const systemPrompt = `
    You are an expert storyboard artist and prompt engineer for high-end AI image generation models.
    Your task is to take a transcript of a story and generate a series of VERY LONG and HIGHLY DETAILED image prompts.
    
    CRITICAL REQUIREMENTS:
    1. EXACT MAPPING: You MUST generate EXACTLY ONE image prompt for EVERY item in the provided transcript array. If the transcript has 9 items, you must return an array of exactly 9 strings. Do NOT combine them. Do NOT skip any.
    2. EXTREME DETAIL & LENGTH: Generating small, generic prompts will result in inconsistent results. You MUST generate extremely detailed, paragraph-length prompts. Describe every aspect of the scene thoroughly to maintain visual continuity.
    3. STYLE (ADULT STORYBOOK): The final output does NOT need to be photo-realistic. It should be a "Sophisticated Adult Storybook" style. Think high-end digital painting, cinematic concept art, rich textures, and artistic compositions. Do NOT make it look like a children's book or cartoon.
    4. CHARACTER CONSISTENCY: Since the image model has no memory, you MUST describe the characters' physical appearance in EXACT detail in EVERY prompt where they appear.
       - Invent the characters based on the story: define their exact age, facial features, hair, clothing, and colors.
       - Repeat these exact descriptions in every single prompt.
    5. ENVIRONMENT CONSISTENCY: Describe the setting (environment, architecture, time of day, lighting, atmosphere, colors) in extreme detail for every prompt to ensure backgrounds remain perfectly consistent.
    6. NO RANDOMNESS: Each prompt should feel like it belongs to the same visual world. Use specific artistic terms (e.g., "chiaroscuro lighting", "muted earthy palette", "intricate details").
    7. FORMAT: Return only the prompts as an array of strings.
  `;

  try {
    const { object } = await generateObject({
      model: model,
      schema: z.object({
        prompts: z.array(z.object({
          originalText: z.string().describe('The original text segment from the transcript.'),
          imagePrompt: z.string().describe('A VERY LONG and HIGHLY DETAILED image prompt for this specific segment.')
        })),
      }),
      system: systemPrompt,
      prompt: `Generate image prompts for the following transcript segments: ${JSON.stringify(transcriptItems)}`,
    });

    return object.prompts.map(p => p.imagePrompt);

  } catch (error) {
    console.error('Error generating image prompts:', error);
    throw error;
  }
}

// Example usage (uncomment to test):
/*
const input = [
  {'start': 0, 'end': 2080, 'text': 'एक लड़का दोस्त के घर गया।'}, 
  {'start': 2180, 'end': 4260, 'text': 'दोस्त ने पूछा, खाना खाएगा?'}, 
  {'start': 4360, 'end': 6600, 'text': 'लड़का बोला, नहीं-नहीं।'}, 
  {'start': 6700, 'end': 8780, 'text': 'अभी घर से खाकर आया हूँ।'}, 
  {'start': 8880, 'end': 11120, 'text': 'तभी समोसे की खुशबू आई।'}, 
  {'start': 11220, 'end': 13300, 'text': 'दोस्त बोला, सच बता।'}, 
  {'start': 13400, 'end': 14360, 'text': 'खाएगा क्या?'}, 
  {'start': 14460, 'end': 16700, 'text': 'लड़का बोला, खाना नहीं खाऊंगा।'}, 
  {'start': 16800, 'end': 18720, 'text': 'बस समोसे से दोस्ती करवा दे।'}
];

generateImagePrompts(input).then(prompts => console.log(prompts));
*/
