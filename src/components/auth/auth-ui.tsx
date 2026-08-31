"use client";

import Link from "next/link";
import { useFormStatus } from "react-dom";

/**
 * Minimal, on-brand building blocks for the auth pages (Design.md §5 forms/
 * buttons). Labeled inputs, visible focus rings, and inline validation messages
 * in Danger — accessibility is not optional (Design.md §6).
 */

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  return (
    <div className="w-full max-w-sm">
      <div className="mb-6 text-center">
        <Link
          href="/"
          className="text-sm font-semibold uppercase tracking-wide text-royal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright"
        >
          AdJury
        </Link>
        <h1 className="mt-3 text-2xl font-bold text-ink">{title}</h1>
        <p className="mt-1 text-sm text-muted">{subtitle}</p>
      </div>

      <div className="rounded-md border border-border bg-surface p-6 shadow-[0_1px_2px_rgba(11,11,15,.06)]">
        {children}
      </div>

      <p className="mt-6 text-center text-sm text-muted">{footer}</p>
    </div>
  );
}

export function Field({
  id,
  label,
  type = "text",
  autoComplete,
  required = true,
  minLength,
  placeholder,
}: {
  id: string;
  label: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  minLength?: number;
  placeholder?: string;
}) {
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-body">
        {label}
      </label>
      <input
        id={id}
        name={id}
        type={type}
        autoComplete={autoComplete}
        required={required}
        minLength={minLength}
        placeholder={placeholder}
        className="w-full rounded-sm border border-border bg-surface px-3 py-2 text-body outline-none focus-visible:border-royal focus-visible:ring-2 focus-visible:ring-royal-bright"
      />
    </div>
  );
}

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="mb-4 text-sm font-medium text-danger">
      {message}
    </p>
  );
}

export function FormNotice({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p role="status" className="mb-4 text-sm font-medium text-success">
      {message}
    </p>
  );
}

export function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className="w-full rounded-sm bg-royal px-4 py-2 font-semibold text-white transition-colors hover:bg-royal-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-royal-bright disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? "Please wait…" : label}
    </button>
  );
}
