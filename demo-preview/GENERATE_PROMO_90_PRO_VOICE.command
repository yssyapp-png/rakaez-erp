#!/bin/zsh

DEMO_DIR="${0:A:h}"
VIDEO_ONLY="$DEMO_DIR/rakaez-promo-90s-video-only.mp4"
SCRIPT_FILE="$DEMO_DIR/PROMO_90_VOICEOVER_PRO_AR.txt"
VOICE_DIR="$DEMO_DIR/voice-90-pro-segments"
FINAL_FILE="$DEMO_DIR/rakaez-promo-90s-professional-male-voice-no-music.mp4"
DOCUMENTS_FILE="$HOME/Documents/فيديو-ركائز-90-ثانية-صوت-رجالي-احترافي-بدون-موسيقى.mp4"
BACKUP_FILE="$HOME/Documents/فيديو-ركائز-الدعائي-90-ثانية-بدون-موسيقى.mp4"
FFMPEG_DIR="$DEMO_DIR/tools/ffmpeg"
STATUS_FILE="$DEMO_DIR/.promo-90-pro-generation-status"

/bin/mkdir -p "$VOICE_DIR"

typeset -a VOICE_FILES
typeset -a RATES
RATES=(154 160 158 164 157 161 155 159 153 150)

scene=0
while IFS= read -r narration || [[ -n "$narration" ]]; do
  [[ -z "$narration" ]] && continue
  scene=$((scene + 1))
  voice_file="$VOICE_DIR/scene-${(l:2::0:)scene}.aiff"
  /usr/bin/say -v Majed -r "${RATES[$scene]}" -o "$voice_file" "$narration"
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
  delay=$(( (index - 1) * 9000 + 560 ))
  FILTER+="[${index}:a]atrim=0:8.15,highpass=f=75,lowpass=f=11500,equalizer=f=145:t=q:w=0.9:g=1.6,equalizer=f=2700:t=q:w=1.1:g=1.2,acompressor=threshold=0.10:ratio=2.2:attack=18:release=180:makeup=1.2,afade=t=in:st=0:d=0.08,afade=t=out:st=7.78:d=0.37,adelay=${delay}:all=1,volume=1.05[v$index];"
done
FILTER+="[v1][v2][v3][v4][v5][v6][v7][v8][v9][v10]amix=inputs=10:normalize=0:dropout_transition=0,loudnorm=I=-16:TP=-1.5:LRA=7,alimiter=limit=0.90,apad=pad_dur=90,atrim=0:90[a]"

if [[ -f "$DOCUMENTS_FILE" ]]; then
  /bin/cp -f "$DOCUMENTS_FILE" "$BACKUP_FILE"
fi

DYLD_LIBRARY_PATH="$FFMPEG_DIR" "$FFMPEG_DIR/ffmpeg" -hide_banner -loglevel error -y \
  "${INPUTS[@]}" -filter_complex "$FILTER" \
  -map 0:v:0 -map "[a]" -c:v copy -c:a aac -b:a 192k -ar 48000 \
  -metadata:s:a:0 title="Arabic male professional narration — no music" \
  -t 90 -movflags +faststart "$FINAL_FILE"

/bin/cp -f "$FINAL_FILE" "$DOCUMENTS_FILE"
print -r -- "ok" > "$STATUS_FILE"
/usr/bin/osascript -e 'display notification "تم حفظ النسخة الجديدة بصوت رجالي محسن وبدون موسيقى" with title "ركائز"' >/dev/null 2>&1
/usr/bin/open -R "$DOCUMENTS_FILE"
