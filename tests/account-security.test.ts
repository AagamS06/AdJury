import { describe, it, expect } from "vitest";
import {
  EmailChangeSchema,
  PasswordChangeSchema,
  firstSecurityIssue,
} from "@/lib/user/account-security";
import {
  MAX_EMAIL_CHARS,
  MAX_PASSWORD_CHARS,
  MIN_PASSWORD_CHARS,
} from "@/lib/validation/limits";

/**
 * Account security contracts (DailyPlan Day 51, Part 2). The password + email
 * changes are Supabase Auth operations whose *effect* needs a live project, but
 * their *validation* is pure and enforced at the boundary (Rules.md §3) — that's
 * what these tests pin, so a malformed/oversized/ mismatched submit is rejected
 * before any Auth call.
 */

describe("PasswordChangeSchema", () => {
  it("accepts a matching password within bounds", () => {
    const parsed = PasswordChangeSchema.safeParse({
      password: "a".repeat(MIN_PASSWORD_CHARS),
      confirm: "a".repeat(MIN_PASSWORD_CHARS),
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a password under the floor", () => {
    const parsed = PasswordChangeSchema.safeParse({
      password: "a".repeat(MIN_PASSWORD_CHARS - 1),
      confirm: "a".repeat(MIN_PASSWORD_CHARS - 1),
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(firstSecurityIssue(parsed.error)).toContain(
        String(MIN_PASSWORD_CHARS),
      );
    }
  });

  it("rejects a password over the ceiling", () => {
    const parsed = PasswordChangeSchema.safeParse({
      password: "a".repeat(MAX_PASSWORD_CHARS + 1),
      confirm: "a".repeat(MAX_PASSWORD_CHARS + 1),
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects when the confirmation doesn't match", () => {
    const parsed = PasswordChangeSchema.safeParse({
      password: "correct-horse",
      confirm: "battery-staple",
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(firstSecurityIssue(parsed.error)).toMatch(/match/i);
    }
  });
});

describe("EmailChangeSchema", () => {
  it("accepts a valid address and normalizes it (trim + lowercase)", () => {
    const parsed = EmailChangeSchema.safeParse({ email: "  NEW@Acme.TEST  " });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.email).toBe("new@acme.test");
  });

  it("rejects an empty address", () => {
    expect(EmailChangeSchema.safeParse({ email: "   " }).success).toBe(false);
  });

  it("rejects a malformed address", () => {
    expect(EmailChangeSchema.safeParse({ email: "not-an-email" }).success).toBe(
      false,
    );
  });

  it("rejects an address over the RFC length ceiling", () => {
    const tooLong = "a".repeat(MAX_EMAIL_CHARS) + "@acme.test";
    expect(EmailChangeSchema.safeParse({ email: tooLong }).success).toBe(false);
  });
});
