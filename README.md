# Story Gen

Project-based Hindi short-video pipeline:

1. Rewrite story into short dialogs
2. Generate TTS audio + transcript
3. Generate image prompts from transcript
4. Generate images with ComfyUI
5. Generate SEO text
6. Preview or render with Remotion

Each story is treated as a separate project under `output/projects/<project-slug>/`.

## Requirements

- Node.js
- OpenRouter API key
- Running TTS server
- Running ComfyUI server
- Chrome or Chromium for Remotion preview/render

## Install

```bash
npm install
```

## Env

Create `.env` from `.env.example`.

Example:

```env
OPENROUTER_API_KEY=your_api_key_here
OPENROUTER_MODEL=x-ai/grok-4.3
STORY_TTS_API_URL=https://YOUR-PINGGY-URL.pinggy.link
COMFY_URL=https://YOUR-COMFY-URL
```

Notes:

- `OPENROUTER_MODEL` is used by:
  - `generateStoryDialogs.js`
  - `generateImagePrompt.js`
  - `generateSeoText.js`
- `STORY_TTS_API_URL` should be the base URL only, not `/generate-story-audio`.

## Main Command

Preview a story project:

```bash
npm run story:preview -- \
  --project-slug jungle-baba \
  --story-file /absolute/path/to/story.txt
```

Inline story:

```bash
npm run story:preview -- \
  --project-slug jungle-baba \
  --story "पूरी हिंदी कहानी यहाँ..."
```

Render instead of opening Remotion Studio:

```bash
npm run story:preview -- \
  --project-slug jungle-baba \
  --story-file /absolute/path/to/story.txt \
  --render
```

Skip Studio launch:

```bash
npm run story:preview -- \
  --project-slug jungle-baba \
  --story-file /absolute/path/to/story.txt \
  --no-studio
```

## Defaults

The runner already has local defaults for:

- reference audio path
- reference transcript
- browser executable
- Remotion port

You can override them:

```bash
--reference-audio-path /path/to/reference.wav
--reference-transcript "reference transcript"
--browser-executable /usr/bin/google-chrome
--port 3031
--pause-ms 350
--cfg 2.8
--steps 15
--seed -1
--locked
```

## Project Structure

For project slug `jungle-baba`:

```text
output/projects/jungle-baba/
  input/story.txt
  dialogs/dialogs.json
  audio/final_story.wav
  audio/final_story_transcript.json
  images/image-prompts.json
  images/1.png
  images/2.png
  ...
  seo/seo.txt
  remotion/story.json
  remotion/story.mp4
```

## Resume Behavior

This pipeline is resumable by generated assets.

If these files already exist, they are reused:

- `dialogs/dialogs.json`
- `audio/final_story.wav`
- `audio/final_story_transcript.json`
- `images/image-prompts.json`
- `images/*.png`
- `seo/seo.txt`

If an image already exists, it is skipped.

If you want to regenerate from a specific step, delete the corresponding generated files and run the same project again.

Examples:

- delete `images/image-prompts.json` to regenerate prompts
- delete some `images/*.png` to regenerate only missing images
- delete `seo/seo.txt` to regenerate SEO text

If a project already has generated assets for a different story, use a new slug or delete that project’s generated outputs first.

## Pipeline Steps

The runner prints detailed progress in the terminal:

1. Story dialogs
2. TTS audio + transcript
3. Image prompts
4. Images
5. SEO text
6. Remotion config, preview, or render

## Remotion

Direct Studio launch for an existing project:

```bash
STORY_PROJECT_SLUG=jungle-baba npm run dev:video
```

Project render output:

```text
output/projects/jungle-baba/remotion/story.mp4
```

The shared npm render script still renders to `out/story.mp4`, but the project runner `--render` mode writes into the project folder.

## SEO Output

SEO step writes plain text only:

```text
Title:
...

Description:
...

Hashtags:
#a #b #c

YouTube Tags:
tag1, tag2, tag3
```

Path:

```text
output/projects/<project-slug>/seo/seo.txt
```

## Core Files

- [scripts/run-story-project.js](./scripts/run-story-project.js)
- [generateStoryDialogs.js](./generateStoryDialogs.js)
- [generateStoryAudio.js](./generateStoryAudio.js)
- [generateImagePrompt.js](./generateImagePrompt.js)
- [generateImage.js](./generateImage.js)
- [storyGenerate.js](./storyGenerate.js)
- [generateSeoText.js](./generateSeoText.js)
- [scripts/sync-remotion-assets.js](./scripts/sync-remotion-assets.js)

## Notes

- Dialog generation currently accepts the first model output.
- Remotion compositions read from generated project story data after asset sync.
- Generated Remotion assets and render outputs are gitignored.
