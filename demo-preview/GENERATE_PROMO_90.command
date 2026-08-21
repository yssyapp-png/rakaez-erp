#!/bin/zsh

DEMO_DIR="${0:A:h}"
VIDEO_ONLY="$DEMO_DIR/rakaez-promo-90s-video-only.mp4"
SCRIPT_FILE="$DEMO_DIR/PROMO_90_VOICEOVER_AR.txt"
VOICE_DIR="$DEMO_DIR/voice-90-segments"
FINAL_FILE="$DEMO_DIR/rakaez-promo-90s-voice-no-music.mp4"
DOCUMENTS_FILE="$HOME/Documents/فيديو-ركائز-الدعائي-90-ثانية-بدون-موسيقى.mp4"
STATUS_FILE="$DEMO_DIR/.promo-90-generation-status"
FFMPEG_DIR="$DEMO_DIR/tools/ffmpeg"

/bin/mkdir -p "$VOICE_DIR"

typeset -a VOICE_FILES
scene=0
while IFS= read -r narration || [[ -n "$narration" ]]; do
  [[ -z "$narration" ]] && continue
  scene=$((scene + 1))
  voice_file="$VOICE_DIR/scene-${(l:2::0:)scene}.aiff"
  /usr/bin/say -v Majed -r 168 -o "$voice_file" "$narration"
  voice_bytes=$(/usr/bin/stat -f%z "$voice_file" 2>/dev/null || print 0)
  if (( voice_bytes < 8192 )); then
    print -r -- "failed-at-scene-$scene" > "$STATUS_FILE"
    exit 1
  fi
  VOICE_FILES+=("$voice_file")
done < "$SCRIPT_FILE"

if (( ${#VOICE_FILES[@]} != 10 )) || [[ ! -f "$VIDEO_ONLY" ]] || [[ ! -x "$FFMPEG_DIR/ffmpeg" ]]; then
  print -r -- "failed-input-validation" > "$STATUS_FILE"
  exit 1
fi

typeset -a INPUTS
INPUTS=(-i "$VIDEO_ONLY")
for voice_file in "${VOICE_FILES[@]}"; do INPUTS+=(-i "$voice_file"); done

FILTER=""
for index in {1..10}; do
  delay=$(( (index - 1) * 9000 + 700 ))
  FILTER+="[${index}:a]atrim=0:7.9,afade=t=out:st=7.55:d=0.35,adelay=${delay}:all=1,volume=1.25[v$index];"
done
FILTER+="[v1][v2][v3][v4][v5][v6][v7][v8][v9][v10]amix=inputs=10:normalize=0:dropout_transition=0,alimiter=limit=0.95,apad=pad_dur=90,atrim=0:90[a]"

DYLD_LIBRARY_PATH="$FFMPEG_DIR" "$FFMPEG_DIR/ffmpeg" -hide_banner -loglevel error -y \
  "${INPUTS[@]}" -filter_complex "$FILTER" \
  -map 0:v:0 -map "[a]" -c:v copy -c:a aac -b:a 160k -ar 48000 \
  -t 90 -movflags +faststart "$FINAL_FILE"

/bin/cp -f "$FINAL_FILE" "$DOCUMENTS_FILE"
print -r -- "ok" > "$STATUS_FILE"
/usr/bin/osascript -e 'display notification "تم حفظ فيديو ركائز الاحترافي لمدة 90 ثانية" with title "ركائز"' >/dev/null 2>&1
/usr/bin/open -R "$DOCUMENTS_FILE"
