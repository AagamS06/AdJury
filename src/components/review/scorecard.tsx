import {
  formatAggregate,
  jurorHealthNotice,
  summarizeJurorHealth,
  verdictLabel,
  verdictTone,
} from "@/lib/reviews/scorecard-view";
import { contentTypeLabel, platformLabel } from "@/lib/reviews/history-view";
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
  /**
   * The review's submitted content, threaded to each JurorCard so its
   * suggested-rewrite panel can show a before/after diff (DailyPlan Day 15).
   * Optional — omit and the rewrite panels simply skip the comparison.
   */
  originalContent?: string | null;
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
  originalContent,
}: ScorecardProps) {
  const pill = PILL_CLASSES[verdictTone(verdict)];
  const created = createdAt ? formatCreatedAt(createdAt) : null;
  const notice = jurorHealthNotice(summarizeJurorHealth(jurors));

  // Reuse the shared history-view label helpers so a review's header meta reads
  // identically to its history row (Design.md §1.4 "consistency is credibility"):
  // the platform shows its human label ("Instagram"), not the raw value.
  const meta = [
    contentType ? contentTypeLabel(contentType) : null,
    platformLabel(platform ?? null),
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

      {/* Degraded-review banner: some or all jurors failed, or none exist.
          A single juror failing is expected and never fails the whole review
          (Rules.md §6) — but the scorecard says so rather than quietly
          rendering fewer cards. */}
      {notice && (
        <div className="px-6 pt-6">
          <p
            role={notice.tone === "danger" ? "alert" : "status"}
            className={`rounded-sm border px-4 py-3 text-sm ${NOTICE_CLASSES[notice.tone]}`}
          >
            {notice.message}
          </p>
        </div>
      )}

      {/* Juror cards */}
      {jurors.length > 0 && (
        <div className="grid gap-4 bg-canvas p-6 sm:grid-cols-2">
          {jurors.map((juror) => (
            <JurorCard
              key={juror.persona}
              juror={juror}
              original={originalContent}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Banner colour by tone (component-layer colour→Tailwind, keeping the lib
 * framework-agnostic). Tinted washes with same-hue text clear WCAG AA and pair
 * the colour with the message text (Design.md §6).
 */
const NOTICE_CLASSES: Record<"warning" | "danger", string> = {
  warning: "border-warning/30 bg-warning/10 text-warning",
  danger: "border-danger/30 bg-danger/10 text-danger",
};
