import { z } from "zod";

/**
 * Input validation for the auth forms (Rules.md §3 — validate before trust).
 * The same schemas guard the server actions so a malformed or oversized submit
 * is rejected at the boundary, never passed to Supabase Auth or the DB.
 */

export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  password: z.string().min(8, "Password must be at least 8 characters."),
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
