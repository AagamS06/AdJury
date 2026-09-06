import {
  formatAggregate,
  verdictLabel,
  verdictTone,
} from "@/lib/reviews/scorecard-view";
import { CONTENT_TYPE_OPTIONS } from "@/lib/reviews/review-form";
import type { JurorSlot, Verdict } from "@/lib/schema/juror";
import { JurorCard } from "./juror-card";
import { PILL_CLASSES } from "./tone-classes";

/**
 * Scorecard (DailyPlan Day 9, Design.md §5): the full review render — a Navy
 * header bar with the aggregate score large and left-aligned and a verdict pill
 * top-right, followed by one JurorCard per juror.
 *
 * Props are the loose shape shared by a freshly-run review (`ReviewResult`) and
 * a persisted one (`PersistedReview`, Day 12) — `aggregate_score`/`verdict` may
 * be null for a stored review that was never scored — so both render the same
 * way. Pure and hook-free: usable from client and server components alike.
 */
export interface ScorecardProps {
  aggregateScore: number | null;
  verdict: Verdict | null;
  jurors: JurorSlot[];
  contentType?: string;
  platform?: string | null;
  createdAt?: string;
}

function contentTypeLabel(value: string): string {
  return CONTENT_TYPE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

function formatCreatedAt(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function Scorecard({
  aggregateScore,
  verdict,
  jurors,
  contentType,
  platform,
  createdAt,
}: ScorecardProps) {
  const pill = PILL_CLASSES[verdictTone(verdict)];
  const created = createdAt ? formatCreatedAt(createdAt) : null;

  const meta = [
    contentType ? contentTypeLabel(contentType) : null,
    platform ? platform : null,
    created,
  ].filter((v): v is string => Boolean(v));

  return (
    <section
      aria-label="Review scorecard"
      className="overflow-hidden rounded-md border border-border bg-surface shadow-[0_1px_2px_rgba(11,11,15,.06)]"
    >
      {/* Navy header bar */}
      <header className="flex items-start justify-between gap-4 bg-navy px-6 py-5 text-white">
        <div>
          <p className="text-sm text-white/70">Aggregate score</p>
          <p className="mt-0.5 text-3xl font-bold tabular-nums">
            {formatAggregate(aggregateScore)}
            <span className="text-lg font-medium text-white/60"> / 10</span>
          </p>
          {meta.length > 0 && (
            <p className="mt-1 text-xs text-white/70">{meta.join(" · ")}</p>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${pill}`}
        >
          <span className="sr-only">Verdict: </span>
          {verdictLabel(verdict)}
        </span>
      </header>

      {/* Juror cards */}
      <div className="grid gap-4 bg-canvas p-6 sm:grid-cols-2">
        {jurors.map((juror) => (
          <JurorCard key={juror.persona} juror={juror} />
        ))}
      </div>
    </section>
  );
}
