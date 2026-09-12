import {
  afterSegments,
  beforeSegments,
  computeRewriteDiff,
  type DiffSegment,
} from "@/lib/reviews/rewrite-diff";
import { CopyButton } from "./copy-button";

/**
 * Suggested-rewrite panel (DailyPlan Day 15, Design.md §5): the juror's
 * suggested rewrite in a lightly tinted panel, with a copy-to-clipboard control
 * and — when the submitted content is available and differs — an expandable
 * before/after highlight of the rewrite versus the original.
 *
 * Hook-free itself (the copy affordance is a nested client island), so it
 * renders in both the client ReviewForm result and the server detail page. When
 * no `original` is passed, or the rewrite matches it, only the rewrite + copy
 * show — the comparison is simply omitted (never an empty toggle).
 *
 * Colour never travels alone (Design.md §6): added words carry an "added" cue
 * and inserted styling, removed words a strike-through and a "removed" cue, and
 * a spoken summary states the counts.
 */
export function RewritePanel({
  rewrite,
  original,
}: {
  rewrite: string;
  original?: string | null;
}) {
  const diff = computeRewriteDiff(original, rewrite);

  return (
    <div className="mt-4 rounded-sm border border-border bg-canvas p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          Suggested rewrite
        </p>
        <CopyButton value={rewrite} />
      </div>
      <p className="mt-1 text-sm leading-relaxed text-body">{rewrite}</p>

      {diff.changed && (
        <details className="mt-3 border-t border-border pt-3">
          <summary className="cursor-pointer text-xs font-medium text-royal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright">
            Compare with original
          </summary>

          {diff.tooLarge ? (
            <PlainCompare rewrite={rewrite} original={original ?? ""} />
          ) : (
            <div className="mt-3 space-y-3">
              <p className="sr-only">
                The rewrite adds {diff.added}{" "}
                {diff.added === 1 ? "word" : "words"} and removes {diff.removed}{" "}
                {diff.removed === 1 ? "word" : "words"} compared with the
                original.
              </p>

              <DiffBlock
                heading="Original"
                segments={beforeSegments(diff.segments)}
                mode="before"
              />
              <DiffBlock
                heading="Rewrite"
                segments={afterSegments(diff.segments)}
                mode="after"
              />

              <p className="text-xs text-muted" aria-hidden="true">
                <span className="rounded-sm bg-danger/10 px-1 text-danger line-through">
                  removed
                </span>{" "}
                ·{" "}
                <span className="rounded-sm bg-success/10 px-1 text-success">
                  added
                </span>
              </p>
            </div>
          )}
        </details>
      )}
    </div>
  );
}

/** One side of the highlighted before/after view. */
function DiffBlock({
  heading,
  segments,
  mode,
}: {
  heading: string;
  segments: DiffSegment[];
  mode: "before" | "after";
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
        {heading}
      </p>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-body">
        {segments.map((seg, i) => {
          if (seg.type === "equal") {
            return <span key={i}>{seg.value}</span>;
          }
          if (mode === "before" && seg.type === "removed") {
            return (
              <span
                key={i}
                className="rounded-sm bg-danger/10 text-danger line-through"
              >
                <span className="sr-only"> removed: </span>
                {seg.value}
              </span>
            );
          }
          if (mode === "after" && seg.type === "added") {
            return (
              <span key={i} className="rounded-sm bg-success/10 text-success">
                <span className="sr-only"> added: </span>
                {seg.value}
              </span>
            );
          }
          return <span key={i}>{seg.value}</span>;
        })}
      </p>
    </div>
  );
}

/** Fallback for over-long content: the two texts plainly, no inline highlight. */
function PlainCompare({
  rewrite,
  original,
}: {
  rewrite: string;
  original: string;
}) {
  return (
    <div className="mt-3 space-y-3">
      <p className="text-xs text-muted">
        This rewrite is long, so it&apos;s shown alongside the original rather
        than highlighted inline.
      </p>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          Original
        </p>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-body">
          {original}
        </p>
      </div>
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          Rewrite
        </p>
        <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-body">
          {rewrite}
        </p>
      </div>
    </div>
  );
}
