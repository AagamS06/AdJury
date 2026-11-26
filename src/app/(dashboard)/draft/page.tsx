import { DraftForm } from "@/components/draft/draft-form";
import { requireSession } from "@/lib/auth/guard";

/**
 * Draft Assistant page (DailyPlan Day 89). Any authenticated, provisioned user
 * may draft copy; `requireSession()` re-checks server-side even though the layout
 * already gated the group (protected pages fail closed on their own — Rules.md
 * §6). The form is a client component that validates and calls `POST /api/draft`.
 *
 * This is AdJury's one optional, clearly-separate *generation* surface (PRD
 * §6.3), kept distinct from `/review` so the jury never grades AdJury's own
 * drafts — the copy here makes that explicit, and a drafted variant only ever
 * reaches the jury if the human chooses to submit it as a new review.
 */
export default async function DraftPage() {
  await requireSession();

  return (
    <div>
      <h1 className="text-3xl font-bold text-ink">Draft assistant</h1>
      <p className="mt-2 max-w-2xl text-body">
        Describe your product, audience, and key message, and AdJury will draft a
        few ad-copy variants to start from. These are suggestions, not a review —
        you edit and approve. When you&rsquo;re happy with one, submit it as a new
        review to have the six jurors score it.
      </p>

      <div className="mt-8">
        <DraftForm />
      </div>
    </div>
  );
}
