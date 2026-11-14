---
name: movie-recap
description: Turn a movie or video file into a narrated Hinglish recap video (5-10% of the original length, every cut 3s or shorter) rendered with Remotion. Use when the user says "recap", "explainer", "movie recap", or gives a video file to summarize into a video. Args: path to the video file.
---

# Movie recap

You do all the understanding and writing yourself, from the subtitles and the frames. Nothing else
writes the script. The only external service is TTS, reached through the dev server that is already running
(`POST /api/v2/tts-preview`, `google/gemini-3.8-flash-tts`, voice Zephyr; not the Lite model, it sounds worse). Do not start or kill the server.

Scripts live next to this file: `prep.sh`, `build.mjs`. Run everything from the project root.

## 1. Setup

- The video path comes from the args. If there is none, ask for it.
- Ask the user the format: **16:9 landscape** (1920x1080) or **9:16 vertical** (1080x1920, footage centered over a blurred copy).
- Workdir `<W>` is `<video path without extension>.recap/`, next to the video (prep creates it).

## 2. Prep

```bash
.claude/skills/movie-recap/prep.sh "<video>"
```

**Subtitles are required.** If prep exits with `REJECTED`, stop and tell the user to put a `.srt` with the
video's name next to it (or use a file with an embedded subtitle track). Never build a recap from frames alone.
The source audio and subtitles can be in any language (English, Hindi, Japanese...). The narration is always Hinglish (step 4).

Prep writes `meta.json` (duration, sheetStep), `subs.srt`, `cuts.txt` (hard cut times in seconds) and
`sheets/sheet-NNN.jpg`: 4x4 frames, one every `sheetStep` seconds, each with its timestamp burned in at the top left.

## 3. Understand the story

Read the whole of `subs.srt` (in chunks if it is long) and **every** sheet, in order. As you go, append to
`<W>/notes.md`, one line per event:

```
00:12:34-00:12:50  Raj finds the letter in his father's drawer, shocked (close-up, good clip)
```

Write the notes as you read, not at the end. They keep the timeline safe if context gets compacted. Record
who the characters are (names come from the subtitles), what happens, and which moments look strong on
screen. Then write a short plot summary at the top of `notes.md`: the setup, the turning points and the ending.

## 4. Write the script

Target length: **5-10% of the source duration**. Hinglish narration runs about 2.2 words per second, so a
22-minute video gives a 66-132s recap, roughly 150-290 words.

Style:
- Always Hinglish, whatever the source language. Translate the story, never copy English subtitle lines into the script.
- Hinglish: Hindi in Devanagari, with the English words people really say ("plan", "boss", "police") in Latin script.
- Open with a one-line hook. Tell it in the present tense, like a friend retelling a movie. Cover the setup, the
  conflict, the turning points and the ending (spoilers are fine). No filler, no "is video mein".
- Split the narration into beats of 1-3 short sentences. Each beat is one TTS call.

Write `<W>/script.json`:

```json
{
  "format": "16:9",
  "beats": [
    { "text": "...", "clips": [[754.0, 2.5], [761.2, 3], [770.0, 2]] }
  ]
}
```

`clips` holds `[startSeconds, durationSeconds]` pairs from the source, which play in order under the beat.
The clip rules:
- **Every clip is 3 seconds or less.** Prefer 2-3s. build.mjs rejects anything longer.
- A clip shows what the narration is saying at that moment. Pick start times from the sheet timestamps you noted.
- Try not to cross a time in `cuts.txt`. build trims any clip that does to its longer side, so no clip shows two shots,
  but the trimmed side may not be the frame you saw. Clips shorter than 0.8s after trimming are dropped.
- Keep the source order unless the story needs otherwise. Do not reuse the same moment twice.
- Give each beat **more** clip time than it needs, about 30% spare (estimate words / 2.2 seconds). build only
  uses as many clips as the narration needs, and shrinks them evenly to fit exactly.
- Skip title cards, credits, logos and black frames.

## 5. Build

```bash
node .claude/skills/movie-recap/build.mjs <W>
```

This voices each beat (cached by text, so reruns only re-voice beats you changed), fits the clips, cuts them
out of the source into `footage.mp4` (only the recap's footage, never a copy of the full movie), and writes
`narration.wav` and `props.json`. If it errors (a clip is too long, or a beat is short on clips), fix
`script.json` and rerun. A recap outside 5-10% means you should add or cut beats.

Then check the footage: grab one frame per clip from `footage.mp4` into a contact sheet and read it, to confirm
every clip matches its narration:

```bash
ffmpeg -v error -y -i <W>/footage.mp4 -vf "select='gt(scene,0.3)+eq(n,0)',scale=320:-2,tile=6x6" -fps_mode vfr -frames:v 3 <W>/check-%d.jpg
```

## 6. Render and preview

Run this yourself, in the background (it takes a while):

```bash
npx remotion render remotion/index.jsx RecapVideo "<W>/recap.mp4" \
  --public-dir="<W>" --props="<W>/props.json" --overwrite --codec=h264 --pixel-format=yuv420p
```

Then tell the user how to watch it:
- Final file: `! xdg-open "<W>/recap.mp4"`
- To scrub the timeline in Remotion Studio, run `! npx remotion studio remotion/index.jsx --public-dir="<W>" --props="<W>/props.json"`
  and pick **RecapVideo**. It opens on the next free port, since 3000 is the dev server.

Report the output path, the length, what percent of the source it is, and the clip count. Then do step 7.

## 7. Social media text

Write `<W>/social.txt` yourself, from `notes.md` and the script:

```
TITLE:
<hook title in Hinglish (Roman script), under 100 characters including exactly 2 hashtags at the end>

DESCRIPTION:
<2-4 short lines in Hinglish: what happens, no big spoiler of the ending, a line asking viewers to like/subscribe>
<3-5 hashtags on the last line>

TAGS:
<comma separated YouTube tags, 15-25 of them, under 500 characters in total: show/movie name, episode, characters, "hindi recap", "explained in hindi", genre>
```

Include the file's path in the final report.
