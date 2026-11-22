-- AdJury migration 0013 — short-form video ads (DailyPlan Day 85).
-- Week 13 (post-v1 formats): AdJury's engine can now review short-form video ads,
-- extending the multi-format input beyond text/image (PRD §6.3). The engine never
-- stores raw video — the short-form pipeline (src/lib/video/short-form.ts) reduces
-- a clip to a bounded analysis (transcript + on-screen text + sampled keyframes)
-- and reviews it through the same six jurors by attaching a representative keyframe
-- and folding the transcript/on-screen text/caption into the copy. So a stored
-- `video_short` review row looks like an image review (content_text + a keyframe
-- data URL), and its `media_type` records that the source format was a video.
--
-- This widens the Day-15a (0008) check constraint to allow 'video_short'. Existing
-- rows are unaffected (they default to 'text'); no backfill is needed. Long-form
-- video ('video_long') is a later phase (it needs a cost/latency sampling+chunking
-- strategy) and is intentionally still NOT allowed — widen this again in the
-- migration that ships long-form.

alter table reviews
  drop constraint if exists reviews_media_type_check;
alter table reviews
  add constraint reviews_media_type_check
  check (media_type in ('text', 'image', 'video_short'));

-- No RLS change: `reviews` already scopes reads/inserts to the caller's company
-- (reviews_select / reviews_insert) and has no client UPDATE/DELETE; the widened
-- column is written on the same server-side insert path as the rest of the row.
