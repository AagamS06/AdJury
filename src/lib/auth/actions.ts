"use server";

import { redirect } from "next/navigation";
import { serverClient } from "@/lib/db/supabase";
import { provisionCompanyForNewUser } from "./provisioning";
import { credentialsSchema, firstIssue, signUpSchema } from "./schema";
import { createServerSupabase } from "./supabase-server";

/**
 * Auth server actions (DailyPlan Day 3) — login, signup (+ company/admin
 * provisioning), logout. Logic lives here, not in the form components
 * (Rules.md §7). Every action validates input with Zod first and returns a
 * plain, actionable message on failure; internal detail stays in logs
 * (Rules.md §6).
 */
export interface AuthFormState {
  error?: string;
  /** Set after a signup that needs email confirmation before login. */
  notice?: string;
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function signInAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = credentialsSchema.safeParse({
    email: field(formData, "email"),
    password: field(formData, "password"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    // Don't reveal whether the email exists — generic message (Rules.md §6).
    return { error: "Invalid email or password." };
  }

  redirect("/");
}

export async function signUpAction(
  _prev: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse({
    email: field(formData, "email"),
    password: field(formData, "password"),
    companyName: field(formData, "companyName"),
  });
  if (!parsed.success) return { error: firstIssue(parsed.error) };

  const { email, password, companyName } = parsed.data;

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error || !data.user) {
    return { error: "Could not create the account. Please try again." };
  }

  // Provision the tenant with the service-role client (bypasses RLS to write
  // the first company + admin rows). Roll back the auth user if this fails so a
  // half-created account can't linger.
  const admin = serverClient();
  try {
    await provisionCompanyForNewUser(admin, {
      userId: data.user.id,
      email,
      companyName,
    });
  } catch (err) {
    console.error("signup provisioning failed", {
      op: "signUpAction",
      userId: data.user.id,
      message: err instanceof Error ? err.message : "unknown error",
    });
    await admin.auth.admin.deleteUser(data.user.id).catch(() => {
      // Best-effort cleanup; nothing more we can safely do here.
    });
    return {
      error: "We couldn't finish setting up your account. Please try again.",
    };
  }

  // With email confirmation enabled the signup returns no session; the user must
  // confirm before they can log in. The company + admin rows already exist.
  if (!data.session) {
    return {
      notice:
        "Account created. Check your email to confirm your address, then log in.",
    };
  }

  redirect("/");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createServerSupabase();
  await supabase.auth.signOut();
  redirect("/login");
}
