#!/bin/zsh

DEMO_DIR="${0:A:h}"
VOICE_FILE="$DEMO_DIR/rakaez-voice-ar.aiff"
STATUS_FILE="$DEMO_DIR/.voice-generation-status"
FINAL_FILE="$DEMO_DIR/rakaez-promo-30s-voice-no-music.mp4"
VIDEO_ONLY="$DEMO_DIR/rakaez-promo-30s-video-only.mp4"
DOCUMENTS_FILE="$HOME/Documents/فيديو-ركائز-الدعائي-30-ثانية-بدون-موسيقى.mp4"
FFMPEG_DIR="$DEMO_DIR/tools/ffmpeg"

/usr/bin/say -v Majed -r 175 -f "$DEMO_DIR/PROMO_VOICEOVER_AR.txt" -o "$VOICE_FILE"

VOICE_BYTES=$(/usr/bin/stat -f%z "$VOICE_FILE" 2>/dev/null || print 0)
if (( VOICE_BYTES < 8192 )) || [[ ! -f "$VIDEO_ONLY" ]] || [[ ! -x "$FFMPEG_DIR/ffmpeg" ]]; then
  print -r -- "failed" > "$STATUS_FILE"
  exit 1
fi

DYLD_LIBRARY_PATH="$FFMPEG_DIR" "$FFMPEG_DIR/ffmpeg" -hide_banner -loglevel error -y \
  -i "$VIDEO_ONLY" -i "$VOICE_FILE" \
  -filter_complex "[1:a]adelay=650:all=1,apad=pad_dur=30,atrim=0:30,volume=1.3[a]" \
  -map 0:v:0 -map "[a]" -c:v copy -c:a aac -b:a 160k -ar 48000 \
  -t 30 -movflags +faststart "$FINAL_FILE"

/bin/cp -f "$FINAL_FILE" "$DOCUMENTS_FILE"
print -r -- "ok" > "$STATUS_FILE"

/usr/bin/osascript -e 'display notification "تم حفظ الفيديو في مجلد المستندات" with title "ركائز"' >/dev/null 2>&1
/usr/bin/open -R "$DOCUMENTS_FILE"
