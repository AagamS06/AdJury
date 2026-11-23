# AdJury — Short-form Video Ad Review

> **Purpose:** how AdJury reviews a **short-form video ad** (DailyPlan Day 85 —
> the first post-v1 format from the Week-13 backlog; PRD §6.3).
>
> This document is the human-readable face of the pipeline in
> `src/lib/video/short-form.ts`, checked by `npm run video:check`. The engine is
> already short-form-video-capable; only the live *ingestion* front door is gated
> on infrastructure this build lacks (see **Blocked / needs credentials**).

---

## What it does

AdJury stays a QA/review layer — it does **not** generate video or add a new juror
(Rules.md §1). A short-form clip is *reduced* to something the existing six jurors
already review, then run through them unchanged:

```
raw clip ─► [processor] ─► VideoAnalysis ─► [reduce] ─► ReviewInput ─► runReview
            transcribe     transcript +      keyframe +    the SAME six jurors
            sample frames  on-screen text +  folded copy
            read on-image  keyframes
```

- **Processor** (`ShortFormVideoProcessor`) turns a clip into a `VideoAnalysis`:
  the spoken **transcript**, the **on-screen text** read off the frames, the
  sampled **keyframes**, and the duration. It is an injectable seam — the offline
  default invents nothing (it reports only what the creative already carries),
  and a live ffmpeg + transcription + OCR processor swaps in behind the same
  interface. This mirrors the Day-23a business-research seam exactly.
- **Reduce** (`buildVideoReviewInput`) folds the caption + transcript + on-screen
  text into the review copy and attaches a **representative keyframe** as the
  vision block, producing a `media_type: "video_short"` review input. From the
  jurors' point of view this is a keyframe + copy — exactly like an image ad.
- **Review** (`reviewShortFormVideo`) runs that input through the real
  orchestrator and the same six jurors, returning the usual scorecard.

## Guards (cost discipline — Rules.md §1 / §6)

Enforced by `checkVideoCreative` before any processing or model spend:

| Guard | Limit |
|---|---|
| Duration | `SHORT_FORM_MIN_SECONDS`–`SHORT_FORM_MAX_SECONDS` (1–60s). Longer is long-form video, not yet supported. |
| Keyframes | `MIN_KEYFRAMES`–`MAX_KEYFRAMES` (1–6) — each frame is sent to every juror. |
| Keyframe size | Each keyframe obeys the Day-15a image payload cap (`checkImageSize`). |
| Copy | The advertiser's caption/copy is required (like an image ad's copy). |

## Verify it offline

```
npm run video:check   # reduces a sample clip, runs all six jurors on the mock, prints the scorecard + readiness
npm test              # tests/short-form-video.test.ts
```

Everything above runs with **no key, no network, no ffmpeg**: the offline
processor + the offline mock model make the whole pipeline reproducible here.

---

## Blocked / needs credentials

The engine reviews short-form video today; the live **ingestion** path needs
infrastructure/credentials this cloud build does not have. Each is a documented
seam, not a stub — the pipeline and its composition with the real jury are proven
offline (`npm run video:check`, reported as `manual` items by
`buildShortFormVideoReadiness`):

1. **Object storage for uploaded clips** — securely store the raw video
   (Supabase storage / S3). PRD §6.3 "production data & hosting".
2. **Keyframe sampling (ffmpeg)** — sample up to `MAX_KEYFRAMES` frames
   server-side; needs ffmpeg + compute.
3. **Audio transcription** — transcribe the clip's audio into the analysis
   transcript; needs a transcription credential.
4. **On-screen text (OCR)** — read text burned into the frames into the analysis
   on-screen text.
5. **Public upload front door** — add `video_short` to `SUBMITTABLE_MEDIA_TYPES`
   and the submission form once 1–4 exist. Until then `POST /api/reviews` rejects
   a `video_short` request as an unknown format, so the public endpoint stays
   honest while the engine is already video-capable.

**Long-form video** (`video_long`) is the next phase: the same pipeline at scale,
needing a sampling/chunking cost strategy because a naive pass breaks the
<$0.01/review and <15s targets (PRD §8). It is intentionally still absent from the
engine vocabulary.

---

_Related: [PRD.md](../PRD.md) §6.3 · [Architecture.md](../Architecture.md) §5 · [DailyPlan.md](../DailyPlan.md) Day 85 · `src/lib/video/short-form.ts`_
