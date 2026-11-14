#!/usr/bin/env bash
# Usage: prep.sh <video>
# Workdir is <video without extension>.recap/ next to the video.
# Writes: meta.json, subs.srt, cuts.txt, sheets/sheet-NNN.jpg. Fails if the video has no subtitles.
set -euo pipefail
src=$(realpath "$1"); dir="${src%.*}.recap"

# Subtitles are required: <video>.srt, else the only .srt in the folder, else the first embedded subtitle stream.
srt="${src%.*}.srt"
if [ ! -f "$srt" ]; then
  others=("$(dirname "$src")"/*.srt)
  [ ${#others[@]} -eq 1 ] && [ -f "${others[0]}" ] && srt=${others[0]}
fi
if [ -f "$srt" ]; then subs=sidecar
elif ffprobe -v error -select_streams s -show_entries stream=index -of csv=p=0 "$src" | grep -q .; then subs=embedded
else echo "REJECTED: no subtitles. Put $(basename "${src%.*}").srt next to the video and rerun." >&2; exit 2
fi

mkdir -p "$dir/sheets"
if [ $subs = sidecar ]; then cp "$srt" "$dir/subs.srt"
else ffmpeg -v error -y -i "$src" -map 0:s:0 "$dir/subs.srt"
fi
[ -s "$dir/subs.srt" ] || { echo "REJECTED: subtitle track is empty or not text." >&2; exit 2; }

dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$src")
# ponytail: ~600 frames per movie keeps reading cost flat; short videos floor at one frame every 2s.
step=$(awk -v d="$dur" 'BEGIN{s=int(d/600+0.5); print (s<2?2:s)}')
printf '{"source":"%s","duration":%s,"sheetStep":%s}\n' "$src" "$dur" "$step" > "$dir/meta.json"

# Hard cuts (seconds, one per line), detected on a downscaled copy for speed.
ffmpeg -v info -i "$src" -an -sn -vf "scale=320:-2,select='gt(scene,0.3)',showinfo" -f null - 2>&1 \
  | grep -o 'pts_time:[0-9.]*' | cut -d: -f2 > "$dir/cuts.txt"

# Contact sheets: 4x4 frames, one every $step seconds, timestamp burned in.
rm -f "$dir"/sheets/*.jpg
ffmpeg -v error -y -i "$src" -an -sn -vf "fps=1/$step,scale=400:-2,drawtext=text='%{pts\:hms}':x=6:y=6:fontsize=22:fontcolor=yellow:box=1:boxcolor=black@0.7,tile=4x4:padding=4:color=black" \
  -q:v 4 "$dir/sheets/sheet-%03d.jpg"

echo "workdir=$dir duration=${dur}s step=${step}s cuts=$(wc -l < "$dir/cuts.txt") sheets=$(ls "$dir/sheets" | wc -l) subs=$subs"
