#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT="/home/ubuntu/SaaSApp-inspect/SaaS App"
OUTPUT_ROOT="/home/ubuntu/OnBoarding/.video-delivery"
mkdir -p "$OUTPUT_ROOT/admin" "$OUTPUT_ROOT/staff"

transcode() {
  local input="$1"
  local output="$2"
  if [ -s "$output" ]; then
    echo "SKIP $(basename "$output")"
    return
  fi
  echo "START $(basename "$output")"
  ffmpeg -hide_banner -loglevel error -y -i "$input" \
    -map 0:v:0 -map 0:a? \
    -vf "scale='min(1280,iw)':-2:flags=lanczos" \
    -c:v libx264 -preset veryfast -crf 27 -maxrate 1600k -bufsize 3200k \
    -c:a aac -b:a 96k -movflags +faststart \
    "$output"
  echo "DONE $(basename "$output")"
}

transcode "$SOURCE_ROOT/Admin Portal/Video A1 — My Project & Operation. Project Setup.mp4" "$OUTPUT_ROOT/admin/admin-project-setup.mp4"
transcode "$SOURCE_ROOT/Admin Portal/Video A2 — Project Tracker.mp4" "$OUTPUT_ROOT/admin/admin-project-tracker.mp4"
transcode "$SOURCE_ROOT/Admin Portal/Video A3 — Health Report and Project Close-out.mp4" "$OUTPUT_ROOT/admin/admin-health-closeout.mp4"
transcode "$SOURCE_ROOT/Admin Portal/Video A4 — Quote Pipeline.mp4" "$OUTPUT_ROOT/admin/admin-quote-pipeline.mp4"
transcode "$SOURCE_ROOT/Admin Portal/Video A5 — Staff Capacity Planner .mp4" "$OUTPUT_ROOT/admin/admin-staff-capacity.mp4"
transcode "$SOURCE_ROOT/Admin Portal/Video A6 — Portal Management.mp4" "$OUTPUT_ROOT/admin/admin-portal-management.mp4"
transcode "$SOURCE_ROOT/Admin Portal/Video A8 — WHS & Compliance and Internal Governance.mp4" "$OUTPUT_ROOT/admin/admin-whs-compliance.mp4"
transcode "$SOURCE_ROOT/Admin Portal/Video A9 — Service Requests .mp4" "$OUTPUT_ROOT/admin/admin-service-requests.mp4"
transcode "$SOURCE_ROOT/Admin Portal/Video A10 — Regulatory Watch.mp4" "$OUTPUT_ROOT/admin/admin-regulatory-watch.mp4"
transcode "$SOURCE_ROOT/Admin Portal/Video A11 — Species Profiles.mp4" "$OUTPUT_ROOT/admin/admin-species-profiles.mp4"

transcode "$SOURCE_ROOT/Staff Portal/Video A1 Projects & Operations. Project Setup.mp4" "$OUTPUT_ROOT/staff/staff-project-setup.mp4"
transcode "$SOURCE_ROOT/Staff Portal/Video S1 — Staff Home, Noticeboard preview .mp4" "$OUTPUT_ROOT/staff/staff-home-noticeboard.mp4"
transcode "$SOURCE_ROOT/Staff Portal/Video S2 — My Projects and Project Tracker.mp4" "$OUTPUT_ROOT/staff/staff-my-projects-tracker.mp4"
transcode "$SOURCE_ROOT/Staff Portal/Video S3 — Learning & Devlopment.Core Training quizzes.mp4" "$OUTPUT_ROOT/staff/staff-learning-development.mp4"
transcode "$SOURCE_ROOT/Staff Portal/Video S4 — WHS & EC Forms.mp4" "$OUTPUT_ROOT/staff/staff-whs-ec-forms.mp4"
transcode "$SOURCE_ROOT/Staff Portal/Video S5 — Species Profiles.mp4" "$OUTPUT_ROOT/staff/staff-species-profiles.mp4"
transcode "$SOURCE_ROOT/Staff Portal/Video S6 — Staff Workload Calender & Service Request.mp4" "$OUTPUT_ROOT/staff/staff-workload-requests.mp4"

echo "All videos prepared in $OUTPUT_ROOT"
