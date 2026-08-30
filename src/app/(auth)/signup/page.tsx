"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signUpAction, type AuthFormState } from "@/lib/auth/actions";
import {
  AuthShell,
  Field,
  FormError,
  FormNotice,
  SubmitButton,
} from "@/components/auth/auth-ui";

const INITIAL: AuthFormState = {};

export default function SignupPage() {
  const [state, formAction] = useActionState(signUpAction, INITIAL);

  return (
    <AuthShell
      title="Create your account"
      subtitle="Set up your company and become its first admin."
      footer={
        <>
          Already have an account?{" "}
          <Link
            href="/login"
            className="font-semibold text-royal hover:text-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
          >
            Log in
          </Link>
        </>
      }
    >
      <form action={formAction} noValidate>
        <FormError message={state.error} />
        <FormNotice message={state.notice} />
        <Field
          id="companyName"
          label="Company name"
          autoComplete="organization"
          minLength={2}
          placeholder="Acme Marketing"
        />
        <Field
          id="email"
          label="Work email"
          type="email"
          autoComplete="email"
          placeholder="you@company.com"
        />
        <Field
          id="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          placeholder="At least 8 characters"
        />
        <SubmitButton label="Create account" />
      </form>
    </AuthShell>
  );
}
