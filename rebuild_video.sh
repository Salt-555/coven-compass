#!/usr/bin/env bash
# Rebuild Coven Compass ad video from clean keyframes with slow Ken Burns motion,
# then burn the $17 overlay. Deterministic — no AI generation needed.
set -e
cd "$(dirname "$0")/ads"

FPS=24
DUR=10
W=704
H=1280

# Each keyframe gets 2.5s (60 frames) with a gentle zoom push
for spec in "1:1" "4:4" "7:7" "9:9"; do
  name="${spec%%:*}"
  echo "segment $name"
  ffmpeg -y -v error -loop 1 -i "frames/t${name}.jpg" \
    -vf "scale=${W}x${H},zoompan=z='min(zoom+0.0006,1.10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=60:s=${W}x${H}:fps=${FPS}" \
    -t 2.5 -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p "/tmp/seg_${name}.mp4"
done

# Concat segments
echo "concat"
cat > /tmp/concat.txt <<EOF
file '/tmp/seg_1.mp4'
file '/tmp/seg_4.mp4'
file '/tmp/seg_7.mp4'
file '/tmp/seg_9.mp4'
EOF
ffmpeg -y -v error -f concat -safe 0 -i /tmp/concat.txt -c copy /tmp/base_clean.mp4

# Burn the $17 overlay
echo "burn overlay v17"
ffmpeg -y -v error -i /tmp/base_clean.mp4 \
  -vf "subtitles=coven-compass-conversion-overlays-v3-17.ass" \
  -c:v libx264 -preset fast -crf 20 -pix_fmt yuv420p \
  -c:a aac -b:a 128k \
  coven-compass-clarity-conversion-v4-17.mp4

echo "DONE: coven-compass-clarity-conversion-v4-17.mp4"
ffprobe -v error -show_entries format=duration -of csv=p=0 coven-compass-clarity-conversion-v4-17.mp4
