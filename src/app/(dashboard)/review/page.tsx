import { ReviewForm } from "@/components/review/review-form";
import { requireSession } from "@/lib/auth/guard";

/**
 * Submit-for-review page (DailyPlan Day 8). Any authenticated, provisioned user
 * may submit content; `requireSession()` re-checks server-side even though the
 * layout already gated the group (protected pages fail closed on their own —
 * Rules.md §6). The form itself is a client component that validates and calls
 * `POST /api/reviews`.
 */
export default async function ReviewPage() {
  await requireSession();

  return (
    <div>
      <h1 className="text-3xl font-bold text-ink">New review</h1>
      <p className="mt-2 max-w-2xl text-body">
        Paste your marketing content and the five jurors will each score it and
        suggest improvements. We critique and suggest — you stay in control.
      </p>

      <div className="mt-8">
        <ReviewForm />
      </div>
    </div>
  );
}
