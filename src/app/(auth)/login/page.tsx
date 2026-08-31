"use client";

import Link from "next/link";
import { useActionState } from "react";
import { signInAction, type AuthFormState } from "@/lib/auth/actions";
import {
  AuthShell,
  Field,
  FormError,
  SubmitButton,
} from "@/components/auth/auth-ui";

const INITIAL: AuthFormState = {};

export default function LoginPage() {
  const [state, formAction] = useActionState(signInAction, INITIAL);

  return (
    <AuthShell
      title="Log in"
      subtitle="Review your marketing content before you publish."
      footer={
        <>
          New to AdJury?{" "}
          <Link
            href="/signup"
            className="font-semibold text-royal hover:text-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
          >
            Create an account
          </Link>
        </>
      }
    >
      <form action={formAction} noValidate>
        <FormError message={state.error} />
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
          autoComplete="current-password"
        />
        <SubmitButton label="Log in" />
      </form>
    </AuthShell>
  );
}
