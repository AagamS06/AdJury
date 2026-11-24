# AdJury — Long-form Video Ad Review

> **Purpose:** how AdJury reviews a **long-form video ad** (DailyPlan Day 86 — the
> second video format, after short-form; PRD §6.3).
>
> This document is the human-readable face of the pipeline in
> `src/lib/video/long-form.ts`, checked by `npm run video:check:long`. The engine is
> already long-form-video-capable; only the live *ingestion* front door is gated on
> infrastructure this build lacks (see **Blocked / needs credentials**).

---

## What it does

AdJury stays a QA/review layer — it does **not** generate video or add a new juror
(Rules.md §1). A long-form clip is *reduced* to the same thing the existing six jurors
already review (a keyframe + copy), exactly like short-form (Day 85) and image ads
(Day 15a), then run through the jurors unchanged:

```
raw clip ─► [sample plan] ─► [select ≤N frames] ─► VideoAnalysis ─► [reduce] ─► runReview
            chunk the        one per chunk,         transcript +     keyframe +   the SAME
            timeline         capped at a budget     on-screen text   folded copy  six jurors
```

- **Sample plan** (`planLongFormSampling`) divides the clip's timeline into chunks of
  ~`LONG_FORM_CHUNK_SECONDS` and targets one keyframe per chunk, capped at
  `LONG_FORM_MAX_KEYFRAMES`. The count is bounded independent of duration.
- **Select** (`selectKeyframes`) picks, for each planned timestamp, the nearest
  candidate frame a live ffmpeg pass produced — thinning a dense candidate set down to
  the budget.
- **Processor** (`LongFormVideoProcessor`) turns the clip into a `VideoAnalysis` (the
  shared short-form shape): selected keyframes, duration, whether audio is present, and
  — once live — the transcript + on-screen text. It is an injectable seam; the offline
  default invents nothing (it reports only what the creative carries), and a live
  ffmpeg + transcription + OCR processor swaps in behind the same interface.
- **Reduce** (`buildLongFormReviewInput`) folds the caption + transcript + on-screen
  text into the review copy (reusing the short-form `assembleVideoCopy`, so the folding
  and content cap are identical across both video formats) and attaches a
  **representative keyframe** as the vision block, producing a `media_type:
  "video_long"` review input. From the jurors' point of view this is a keyframe + copy —
  exactly like an image ad.
- **Review** (`reviewLongFormVideo`) runs that input through the real orchestrator and
  the same six jurors, returning the usual scorecard.

## The cost/latency strategy (the point of Day 86)

Reviewing a long clip the naive way — transcribe the whole thing, send many frames —
breaks the PRD §8 targets (<$0.01/review, <15s latency). The pipeline bounds the
reduction **before** the fan-out ever runs, so:

> **The model fan-out is bounded independent of clip length.**

However long the clip, the review is exactly the six jurors, each sent **one**
representative keyframe and copy capped at the shared `MAX_CONTENT_CHARS`. A 30-minute
clip costs the same six-juror fan-out, and the same per-juror payload budget, as a
one-minute one — the length is absorbed by the sampling/chunking, not by spending more
per review. `npm run video:check:long` prints this side by side (this clip vs. a
30-minute clip → identical fan-out), and `reconcileLongFormVideo` fails on drift.

## Guards (cost discipline — Rules.md §1 / §6)

Enforced by `checkLongFormCreative` before any processing or model spend:

| Guard | Limit |
|---|---|
| Duration | `LONG_FORM_MIN_SECONDS`–`LONG_FORM_MAX_SECONDS` (61s–30min). Clips ≤60s are short-form video; longer than 30min is rejected. |
| Candidate frames | 1–`LONG_FORM_MAX_CANDIDATES` — bounds the guard and the request size; the selection then thins these to `LONG_FORM_MAX_KEYFRAMES`. |
| Keyframe size | Each candidate obeys the Day-15a image payload cap (`checkImageSize`). |
| Copy | The advertiser's caption/copy is required (like every visual ad's copy). |

## Verify it offline

```
npm run video:check:long   # reduces a sample clip (+ a 30-min clip), runs all six jurors on the mock, prints the scorecard, cost bound + readiness
npm test                   # tests/long-form-video.test.ts
```

Everything above runs with **no key, no network, no ffmpeg**: the offline processor +
the offline mock model make the whole pipeline reproducible here.

---

## Blocked / needs credentials

The engine reviews long-form video today; the live **ingestion** path needs
infrastructure/credentials this cloud build does not have. Each is a documented seam,
not a stub — the pipeline and its bounded composition with the real jury are proven
offline (`npm run video:check:long`, reported as `manual` items by
`buildLongFormVideoReadiness`):

1. **Object storage for uploaded clips** — securely store the raw (long) video
   (Supabase storage / S3). PRD §6.3 "production data & hosting".
2. **Keyframe sampling at the planned timestamps (ffmpeg)** — decode a frame at each
   `planLongFormSampling()` target (≤ `LONG_FORM_MAX_KEYFRAMES`) server-side; needs
   ffmpeg + compute.
3. **Chunked audio transcription** — transcribe the (chunked) audio into the analysis
   transcript; needs a transcription credential. The result is bounded to the
   transcript cap, so even a 30-minute clip's transcript folds into budget-bounded copy.
4. **On-screen text (OCR)** — read text burned into the sampled frames into the
   analysis on-screen text.
5. **Public upload front door** — add `video_long` to `SUBMITTABLE_MEDIA_TYPES` and the
   submission form once 1–4 exist. Until then `POST /api/reviews` rejects a `video_long`
   request as an unknown format, so the public endpoint stays honest while the engine is
   already video-capable.

---

_Related: [PRD.md](../PRD.md) §6.3 / §8 · [Architecture.md](../Architecture.md) §5 · [DailyPlan.md](../DailyPlan.md) Day 86 · [VIDEO_REVIEW.md](VIDEO_REVIEW.md) (short-form) · `src/lib/video/long-form.ts`_
