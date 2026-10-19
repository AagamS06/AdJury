/**
 * Account security — pure input contracts for the credential changes (DailyPlan
 * Day 51, Part 2).
 *
 * The password and email changes are Supabase **Auth** operations
 * (`supabase.auth.updateUser`), so their *effect* can only run against a live
 * project — but their *validation* is pure and testable, and belongs here (out of
 * the server action, like every other input contract). The action validates with
 * these schemas before it ever calls Supabase Auth (Rules.md §3 — validate before
 * trust), so a malformed/oversized submit is rejected at the boundary.
 */
import { z } from "zod";
import {
  MAX_EMAIL_CHARS,
  MAX_PASSWORD_CHARS,
  MIN_PASSWORD_CHARS,
} from "@/lib/validation/limits";

/**
 * Change-password contract. The new password reuses the same bounds as signup
 * (Day 45 — input hardening), and a confirmation field must match so a typo can't
 * silently lock the user out. We do not take the current password: an active
 * Supabase session is itself the proof of identity for `updateUser`, so requiring
 * it would add a second live-auth round-trip without changing the trust model.
 */
export const PasswordChangeSchema = z
  .object({
    password: z
      .string()
      .min(
        MIN_PASSWORD_CHARS,
        `Password must be at least ${MIN_PASSWORD_CHARS} characters.`,
      )
      .max(
        MAX_PASSWORD_CHARS,
        `Password must be ${MAX_PASSWORD_CHARS} characters or fewer.`,
      ),
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: "Those passwords don't match.",
    path: ["confirm"],
  });

export type PasswordChangeInput = z.infer<typeof PasswordChangeSchema>;

/**
 * Change-email contract. Reuses the auth email rules (trimmed, lower-cased, RFC
 * length ceiling, valid format). The *new* address is client-supplied here (it is
 * the thing being changed) — distinct from tenancy identity, which is still the
 * server session — and Supabase sends a confirmation link to it before the change
 * takes effect, so an unverified address never becomes the account's email.
 */
export const EmailChangeSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Enter your new email address.")
    .max(MAX_EMAIL_CHARS, "That email address is too long.")
    .email("Enter a valid email address."),
});

export type EmailChangeInput = z.infer<typeof EmailChangeSchema>;

/** First human-readable validation message, for surfacing in a form. */
export function firstSecurityIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the form and try again.";
}
