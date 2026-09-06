import {
  confidenceLabel,
  scoreTone,
  severityLabel,
} from "@/lib/reviews/scorecard-view";
import { PERSONA_LABELS } from "@/lib/reviews/review-form";
import type { Issue, JurorSlot } from "@/lib/schema/juror";
import { CHIP_CLASSES } from "./tone-classes";

/**
 * JurorCard (DailyPlan Day 9, Design.md §5): one juror's verdict — name (H3),
 * a colour-mapped score chip, a one-line summary, an expandable issues list,
 * and the suggested rewrite in a lightly tinted panel.
 *
 * A pure presentational component (no hooks) so it renders in both the client
 * ReviewForm result panel and, later, the server-rendered detail page (Day 12).
 * A juror that failed to return a valid result (Rules.md §6) renders its own
 * error state rather than a fake score. Meaning is never colour-only: the score
 * chip carries the number and the severity badge carries its word (Design.md §6).
 */
export function JurorCard({ juror }: { juror: JurorSlot }) {
  const label = PERSONA_LABELS[juror.persona] ?? juror.persona;

  if (juror.status === "error") {
    return (
      <article className="rounded-md border border-border bg-surface p-5 shadow-[0_1px_2px_rgba(11,11,15,.06)]">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg font-semibold text-ink">{label}</h3>
          <span className="shrink-0 rounded-sm bg-canvas px-2 py-1 text-xs font-medium text-muted ring-1 ring-border">
            No result
          </span>
        </div>
        <p className="mt-2 text-sm text-muted">
          This juror couldn&apos;t return a valid result for this review. The
          other jurors&apos; scores are unaffected.
        </p>
      </article>
    );
  }

  const chip = CHIP_CLASSES[scoreTone(juror.score)];

  return (
    <article className="rounded-md border border-border bg-surface p-5 shadow-[0_1px_2px_rgba(11,11,15,.06)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-ink">{label}</h3>
          <p className="mt-0.5 text-xs text-muted">
            {confidenceLabel(juror.confidence)}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-sm px-2.5 py-1 text-sm font-semibold tabular-nums ${chip}`}
        >
          {juror.score}
          <span className="font-normal opacity-70"> / 10</span>
        </span>
      </div>

      <p className="mt-3 text-sm leading-relaxed text-body">{juror.summary}</p>

      <JurorIssues issues={juror.issues} />

      <div className="mt-4 rounded-sm border border-border bg-canvas p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">
          Suggested rewrite
        </p>
        <p className="mt-1 text-sm leading-relaxed text-body">
          {juror.suggested_rewrite}
        </p>
      </div>
    </article>
  );
}

function JurorIssues({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) {
    return (
      <p className="mt-3 text-sm text-muted">No issues flagged on this lens.</p>
    );
  }

  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-sm font-medium text-royal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright">
        {issues.length} {issues.length === 1 ? "issue" : "issues"} flagged
      </summary>
      <ul className="mt-2 space-y-3">
        {issues.map((issue, i) => (
          <li
            key={i}
            className="rounded-sm border-l-2 border-border pl-3 text-sm"
          >
            <div className="flex items-center gap-2">
              <span className="rounded-sm bg-canvas px-1.5 py-0.5 text-xs font-medium text-body ring-1 ring-border">
                {severityLabel(issue.severity)}
              </span>
            </div>
            <p className="mt-1 font-medium text-body">
              &ldquo;{issue.excerpt}&rdquo;
            </p>
            <p className="mt-0.5 text-muted">{issue.explanation}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}
