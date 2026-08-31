import { describe, it, expect } from "vitest";
import { credentialsSchema, signUpSchema } from "@/lib/auth/schema";

/**
 * The auth forms and server actions share these schemas (Rules.md §3 — validate
 * before trust). Cover the boundary cases the UI relies on.
 */
describe("credentialsSchema", () => {
  it("accepts a valid email + password and normalizes the email", () => {
    const result = credentialsSchema.safeParse({
      email: "  Person@Company.COM ",
      password: "supersecret",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBe("person@company.com");
  });

  it("rejects an invalid email", () => {
    expect(
      credentialsSchema.safeParse({ email: "not-an-email", password: "supersecret" })
        .success,
    ).toBe(false);
  });

  it("rejects a password shorter than 8 characters", () => {
    const result = credentialsSchema.safeParse({
      email: "person@company.com",
      password: "short",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toMatch(/at least 8/);
    }
  });
});

describe("signUpSchema", () => {
  it("accepts a valid signup", () => {
    expect(
      signUpSchema.safeParse({
        email: "person@company.com",
        password: "supersecret",
        companyName: "Acme Marketing",
      }).success,
    ).toBe(true);
  });

  it("rejects a company name that is too short", () => {
    expect(
      signUpSchema.safeParse({
        email: "person@company.com",
        password: "supersecret",
        companyName: "A",
      }).success,
    ).toBe(false);
  });

  it("rejects a company name over 120 characters", () => {
    expect(
      signUpSchema.safeParse({
        email: "person@company.com",
        password: "supersecret",
        companyName: "x".repeat(121),
      }).success,
    ).toBe(false);
  });
});
