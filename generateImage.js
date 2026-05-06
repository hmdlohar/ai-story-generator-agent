import fs from 'fs/promises';
import path from 'path';

const COMFY_URL = process.env.COMFY_URL || 'https://helped-orca-wrongly.ngrok-free.app';

/**
 * Generates an image using ComfyUI and saves it to the specified path.
 * 
 * @param {string} prompt - The text prompt for image generation.
 * @param {string} filePath - The path where the generated image should be saved.
 */
export async function generateImage(prompt, filePath) {
  try {
    // 1. Read workflow.json
    const workflowPath = path.resolve('workflow.json');
    const workflowData = await fs.readFile(workflowPath, 'utf-8');
    
    // 2. Parse workflow and replace $$prompt safely
    let workflow = JSON.parse(workflowData);
    const seed = Math.floor(Math.random() * 1000000000000000);

    // Recursive function to replace $$prompt and randomize seeds
    const processNode = (obj) => {
      for (const key in obj) {
        if (typeof obj[key] === 'object' && obj[key] !== null) {
          processNode(obj[key]);
        } else if (typeof obj[key] === 'string' && obj[key].includes('$$prompt')) {
          obj[key] = obj[key].replace(/\$\$prompt/g, prompt);
        } else if (key === 'seed' && typeof obj[key] === 'number') {
          obj[key] = seed;
        }
      }
    };
    processNode(workflow);

    const client_id = Math.random().toString(36).substring(2);


    // 3. Submit the prompt to ComfyUI
    const response = await fetch(`${COMFY_URL}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        prompt: workflow,
        client_id: client_id
      }),
    });


    if (!response.ok) {
      throw new Error(`ComfyUI prompt submission failed: ${response.statusText}`);
    }

    const { prompt_id } = await response.json();
    console.log(`Prompt submitted. ID: ${prompt_id}`);

    // 4. Polling for completion
    let imageFilename = null;
    let attempts = 0;
    const maxAttempts = 300; // 5 minutes max

    while (attempts < maxAttempts) {
      const historyResponse = await fetch(`${COMFY_URL}/history/${prompt_id}`);
      const history = await historyResponse.json();

      if (history[prompt_id]) {
        const h = history[prompt_id];
        
        // Check if there are any error messages in the history
        if (h.status && h.status.messages) {
          const errors = h.status.messages.filter(m => m[0] === 'execution_error');
          if (errors.length > 0) {
            console.error('ComfyUI Execution Error:', JSON.stringify(errors, null, 2));
            throw new Error(`ComfyUI execution failed: ${errors[0][1].exception_type} - ${errors[0][1].exception_message}`);
          }
        }

        const outputs = h.outputs;
        console.log(`Prompt ${prompt_id} state:`, h.status?.completed ? 'Completed' : 'Running');

        if (h.status?.completed) {
          // Find the image in the outputs
          for (const nodeId in outputs) {
            if (outputs[nodeId].images && outputs[nodeId].images.length > 0) {
              imageFilename = outputs[nodeId].images[0].filename;
              break;
            }
          }

          if (!imageFilename) {
            console.log('Full history object for failed prompt:', JSON.stringify(h, null, 2));
            throw new Error('Image generation completed but no filename was found in history. Check the console for full history log.');
          }
          break;
        }
      }

      attempts++;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (attempts >= maxAttempts) {
      throw new Error('Timed out waiting for image generation.');
    }

    if (!imageFilename) {
      throw new Error('Image generation completed but no filename was found in history.');
    }

    // 5. Fetch the image data
    const viewResponse = await fetch(`${COMFY_URL}/view?filename=${imageFilename}&type=output`);
    if (!viewResponse.ok) {
      throw new Error(`Failed to fetch image from ComfyUI: ${viewResponse.statusText}`);
    }

    const imageBuffer = Buffer.from(await viewResponse.arrayBuffer());

    // 6. Save to filePath
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, imageBuffer);

    console.log(`Image saved to ${filePath}`);
    return filePath;
  } catch (error) {
    console.error('Error generating image:', error);
    throw error;
  }
}
