import { z } from "zod";
import {
  MAX_EMAIL_CHARS,
  MAX_PASSWORD_CHARS,
  MIN_PASSWORD_CHARS,
} from "@/lib/validation/limits";

/**
 * Input validation for the auth forms (Rules.md §3 — validate before trust).
 * The same schemas guard the server actions so a malformed or oversized submit
 * is rejected at the boundary, never passed to Supabase Auth or the DB.
 *
 * Both credentials are length-bounded (DailyPlan Day 45 — input hardening): the
 * email to the RFC ceiling and the password to a generous cap, so an unbounded
 * string never reaches Supabase Auth (a long password otherwise means expensive
 * server-side hashing work on attacker-controlled input).
 */

export const credentialsSchema = z.object({
  email: z
    .string()
    .trim()
    .toLowerCase()
    .min(1, "Enter your email address.")
    .max(MAX_EMAIL_CHARS, "That email address is too long.")
    .email("Enter a valid email address."),
  password: z
    .string()
    .min(MIN_PASSWORD_CHARS, `Password must be at least ${MIN_PASSWORD_CHARS} characters.`)
    .max(MAX_PASSWORD_CHARS, `Password must be ${MAX_PASSWORD_CHARS} characters or fewer.`),
});

export const signUpSchema = credentialsSchema.extend({
  companyName: z
    .string()
    .trim()
    .min(2, "Company name must be at least 2 characters.")
    .max(120, "Company name must be 120 characters or fewer."),
});

export type Credentials = z.infer<typeof credentialsSchema>;
export type SignUpInput = z.infer<typeof signUpSchema>;

/** First human-readable validation message, for surfacing in a form. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Please check the form and try again.";
}
