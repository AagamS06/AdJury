-- AdJury migration 0008 — multi-format ads (DailyPlan Day 15a).
-- Week 3 (core engine): AdJury reviews ads in more than one format so it reaches
-- the widest set of advertisers (PRD §4/§6). `media_type` records the format a
-- review was run on. `text` is the original copy ad; `image` is a visual ad
-- reviewed together with its accompanying copy. Short- and long-form video are a
-- later phase (they need a transcription + frame-sampling pipeline), so the check
-- constraint intentionally allows only the formats shipped today — widen it in the
-- migration that ships video.
--
-- Defaults to 'text' so every existing review and every existing code path reads
-- unchanged (back-compat); NOT NULL with the default means no backfill is needed.

alter table reviews
  add column if not exists media_type text not null default 'text';

alter table reviews
  drop constraint if exists reviews_media_type_check;
alter table reviews
  add constraint reviews_media_type_check
  check (media_type in ('text', 'image'));

-- No RLS change: `reviews` already scopes reads/inserts to the caller's company
-- (reviews_select / reviews_insert) and has no client UPDATE/DELETE; the new
-- column is written on the same server-side insert path as the rest of the row.
