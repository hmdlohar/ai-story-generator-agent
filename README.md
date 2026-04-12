# AI Story Generator

A complete Hindi story-to-video pipeline that transforms Hindi stories into engaging videos with AI-generated images, text-to-speech narration, and subtitles.

## Features

- **Story Generation**: Convert Hindi story ideas into well-crafted narratives using AI
- **Text-to-Speech**: Generate natural Hindi audio narration (via Sarvam AI)
- **Subtitle Generation**: Auto-generate SRT subtitles from audio (via Whisper)
- **Image Generation**: Create illustrations from subtitle segments (via ComfyUI or OpenRouter)
- **Video Creation**: Combine everything into a video with Ken Burns effect and crossfade transitions (via FFmpeg)
- **Resumable**: Image generation is resumable - resume from where you left off

## Tech Stack

- **Backend**: Node.js, Express
- **AI**: OpenRouter (LLM + image generation), Sarvam AI (TTS), OpenAI Whisper
- **Video**: FFmpeg
- **Images**: ComfyUI (self-hosted) or OpenRouter (cloud)

## Project Structure

```
story-generator/
├── server.js          # Express server with all API endpoints
├── public/
│   └── story.html    # Frontend UI
├── storage/          # Project data (images, audio, video)
├── comfy-workflows/  # ComfyUI workflows
├── scripts/         # Utility scripts
└── .env.example     # Environment template
```

## Getting Started

### Prerequisites

- Node.js 18+
- FFmpeg
- API keys (see below)

### Installation

```bash
npm install
```

### Configuration

Copy `.env.example` to `.env` and add your API keys:

```bash
cp .env.example .env
```

Required environment variables:

| Variable | Description | Get from |
|----------|-------------|----------|
| `OPENROUTER_API_KEY` | LLM + image generation | [openrouter.ai](https://openrouter.ai) |
| `SARVAM_API_KEY` | Hindi TTS | [sarvam.ai](https://sarvam.ai) |
| `OPENAI_API_KEY` | Whisper subtitles | [openai.com](https://openai.com) |
| `COMFY_URL` | ComfyUI server (optional) | Self-hosted |

Optional variables:

```bash
# Image generation (defaults shown)
OPENROUTER_IMAGE_MODEL=sourceful/riverflow-v2-fast
IMAGE_WIDTH=810
IMAGE_HEIGHT=1440
```

### Run

```bash
npm start
```

Server runs at `http://localhost:3000`

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/models` | List available LLM models |
| `POST` | `/api/generate` | Generate story from idea |
| `POST` | `/api/tts` | Generate TTS audio |
| `POST` | `/api/subtitle` | Generate SRT from audio |
| `POST` | `/api/image-prompts` | Generate image prompts from SRT |
| `POST` | `/api/generate-images` | Generate images (ComfyUI or OpenRouter) |
| `POST` | `/api/generate-video` | Create final video |

## Usage

1. Open `http://localhost:3000`
2. Enter a Hindi story idea
3. Generate the story (LLM converts to narrative)
4. Generate TTS audio
5. Generate subtitles
6. Generate image prompts
7. Generate images
8. Create video

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3000 | Server port |
| `STORAGE_ROOT_DIR` | ./storage | Project data directory |
| `COMFY_URL` | (empty) | ComfyUI server URL |
| `COMFY_WORKFLOW` | (path to workflow) | ComfyUI workflow file |
| `OPENROUTER_IMAGE_MODEL` | sourceful/riverflow-v2-fast | Image generation model |
| `IMAGE_WIDTH` | 810 | Image width |
| `IMAGE_HEIGHT` | 1440 | Image height |

## Storage Structure

Project data stored in `storage/projects/{projectId}/`:

```
storage/projects/story2/
├── input.txt          # Original story idea
├── story.txt         # Generated narrative
├��─ audio.wav        # TTS audio
├── subtitle.srt      # Generated subtitles
├── image-prompts.json # Image prompts
├── images/          # Generated images (1.png, 2.png, ...)
└── video.mp4         # Final video
```

## License

MIT

## Contributing

Contributions welcome! Please open an issue or PR.