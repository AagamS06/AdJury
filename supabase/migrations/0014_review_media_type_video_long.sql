-- AdJury migration 0014 — long-form video ads (DailyPlan Day 86).
-- Week 13 (post-v1 formats): AdJury's engine can now review long-form video ads as
-- well as short-form (migration 0013), extending the multi-format input (PRD §6.3).
-- As with short-form, the engine never stores raw video — the long-form pipeline
-- (src/lib/video/long-form.ts) reduces a clip to a bounded analysis (sampled/chunked
-- keyframes + transcript + on-screen text) and reviews it through the same six jurors
-- by attaching a representative keyframe and folding the transcript/on-screen
-- text/caption into the copy. So a stored `video_long` review row looks like an image
-- review (content_text + a keyframe data URL), and its `media_type` records that the
-- source format was a long-form video.
--
-- This widens the 0013 check constraint to also allow 'video_long'. Existing rows are
-- unaffected (they keep their stored value; new text rows default to 'text'); no
-- backfill is needed. `video_long` is an ENGINE format only — it is deliberately NOT
-- added to the public submittable set (src/lib/schema/juror.ts SUBMITTABLE_MEDIA_TYPES),
-- because the live video upload front door (object storage + ffmpeg/transcription/OCR)
-- is infrastructure this build lacks; POST /api/reviews rejects a video_long request
-- until that ships (docs/LONG_FORM_VIDEO.md).

alter table reviews
  drop constraint if exists reviews_media_type_check;
alter table reviews
  add constraint reviews_media_type_check
  check (media_type in ('text', 'image', 'video_short', 'video_long'));

-- No RLS change: `reviews` already scopes reads/inserts to the caller's company
-- (reviews_select / reviews_insert) and has no client UPDATE/DELETE; the widened
-- column is written on the same server-side insert path as the rest of the row.
