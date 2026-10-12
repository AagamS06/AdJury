import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ZodTypeAny } from "zod";
import {
  AUDITED_INPUT_SCHEMAS,
  INPUT_SCHEMA_SOURCE_FILES,
  checkEnumClosed,
  checkStringBound,
  emailSample,
  findExportedSchemaNames,
  reconcileAuditedSchemas,
  type BuildCandidate,
  type EnumClosedSpec,
  type SafeParse,
  type StringBoundSpec,
} from "@/lib/validation/input-audit";
import {
  MAX_EMAIL_CHARS,
  MAX_INVITE_TOKEN_CHARS,
  MAX_PASSWORD_CHARS,
  MAX_PLATFORM_CHARS,
  MAX_USER_ID_CHARS,
  MIN_PASSWORD_CHARS,
} from "@/lib/validation/limits";
import { credentialsSchema, signUpSchema } from "@/lib/auth/schema";
import {
  CompanyOnboardingSchema,
} from "@/lib/company/onboarding";
import {
  CreateInvitationSchema,
  isWellFormedInviteToken,
} from "@/lib/company/invitations";
import { RoleChangeSchema } from "@/lib/company/role-management";
import {
  BrandProfileSchema,
  MAX_TONE_GUIDE_CHARS,
  MIN_TONE_GUIDE_CHARS,
} from "@/lib/company/brand-profile";
import { ReviewRequestSchema } from "@/lib/schema/juror";
import { MAX_CONTENT_CHARS } from "@/lib/ai/cost";

/**
 * Input-hardening audit (DailyPlan Day 45 — Week 7 security pass).
 *
 * "Validation/sanitization + size-limit sweep on all inputs. DoD: malformed/
 * oversized inputs rejected cleanly."
 *
 * Part 1 drives the REAL input schemas through the generic bound checks: every
 * user-supplied string field accepts a value at its cap and rejects one over (and
 * one under its floor, where it has one), rejects a non-string, and honours its
 * optional/nullable posture; every enum field is a closed set. This proves the
 * DoD field-by-field rather than restating it.
 *
 * Part 2 pins the specific size limits the Day-45 sweep added (platform, email,
 * password, user id, invite token) as explicit regressions.
 *
 * Part 3 is the drift guard: it reads the dedicated input-schema source files and
 * reconciles every exported `*Schema` against `AUDITED_INPUT_SCHEMAS`, so a new
 * input schema can't ship without being added to this audit.
 */

const parseOf = (schema: ZodTypeAny): SafeParse => (input) => schema.safeParse(input);

/** A builder that clones a valid base object with one field overridden. */
function setter(base: Record<string, unknown>, field: string): BuildCandidate {
  return (value) => ({ ...base, [field]: value });
}

// Valid base inputs for each schema — every field well-formed, so overriding one
// field isolates that field's contract.
const credBase = { email: "founder@example.com", password: "a-good-password" };
const signUpBase = { ...credBase, companyName: "Acme Marketing" };
const onboardingBase = {
  name: "Acme Marketing",
  industry: "saas",
  plan_tier: "free",
  website_url: "",
};
const inviteBase = { email: "teammate@example.com", role: "member" };
const roleBase = { userId: "a1b2c3d4-user", role: "member" };
const brandBase = { tone_guide_text: "Confident, concise, expert. Avoid hype." };
const reviewBase = {
  content_text: "Try our new tool — it saves you an hour a day.",
  content_type: "ad_copy",
  platform: null,
  media_type: "text",
  image: null,
};

// ── Part 1: every user input string field is bounded; every enum is closed ──

interface StringCase {
  schema: ZodTypeAny;
  base: Record<string, unknown>;
  spec: StringBoundSpec;
}

const STRING_CASES: StringCase[] = [
  // Auth credentials — email bounded to the RFC ceiling, password min..max.
  {
    schema: credentialsSchema,
    base: credBase,
    spec: { field: "email", max: MAX_EMAIL_CHARS, sample: emailSample },
  },
  {
    schema: credentialsSchema,
    base: credBase,
    spec: { field: "password", min: MIN_PASSWORD_CHARS, max: MAX_PASSWORD_CHARS },
  },
  // Signup inherits the credential bounds and adds a bounded company name.
  {
    schema: signUpSchema,
    base: signUpBase,
    spec: { field: "email", max: MAX_EMAIL_CHARS, sample: emailSample },
  },
  {
    schema: signUpSchema,
    base: signUpBase,
    spec: { field: "password", min: MIN_PASSWORD_CHARS, max: MAX_PASSWORD_CHARS },
  },
  {
    schema: signUpSchema,
    base: signUpBase,
    spec: { field: "companyName", min: 2, max: 120 },
  },
  // Onboarding — bounded name, optional bounded website.
  {
    schema: CompanyOnboardingSchema,
    base: onboardingBase,
    spec: { field: "name", min: 2, max: 120 },
  },
  {
    schema: CompanyOnboardingSchema,
    base: onboardingBase,
    spec: { field: "website_url", max: 300, optional: true },
  },
  // Invitation — bounded email.
  {
    schema: CreateInvitationSchema,
    base: inviteBase,
    spec: { field: "email", max: MAX_EMAIL_CHARS, sample: emailSample },
  },
  // Role change — bounded target user id.
  {
    schema: RoleChangeSchema,
    base: roleBase,
    spec: { field: "userId", min: 1, max: MAX_USER_ID_CHARS },
  },
  // Brand profile — bounded tone guide.
  {
    schema: BrandProfileSchema,
    base: brandBase,
    spec: { field: "tone_guide_text", min: MIN_TONE_GUIDE_CHARS, max: MAX_TONE_GUIDE_CHARS },
  },
  // Review request (the client boundary) — bounded content, bounded optional
  // nullable platform.
  {
    schema: ReviewRequestSchema,
    base: reviewBase,
    spec: { field: "content_text", min: 1, max: MAX_CONTENT_CHARS },
  },
  {
    schema: ReviewRequestSchema,
    base: reviewBase,
    spec: { field: "platform", max: MAX_PLATFORM_CHARS, optional: true, nullable: true },
  },
];

describe("input hardening — every user input string field is bounded", () => {
  for (const { schema, base, spec } of STRING_CASES) {
    it(`${spec.field} accepts its cap and rejects empty/oversized/malformed input`, () => {
      const result = checkStringBound(parseOf(schema), setter(base, spec.field), spec);
      // Surface the exact expectations that failed, not just a boolean.
      expect(result.failures).toEqual([]);
      expect(result.ok).toBe(true);
    });
  }
});

interface EnumCase {
  schema: ZodTypeAny;
  base: Record<string, unknown>;
  spec: EnumClosedSpec;
}

const ENUM_CASES: EnumCase[] = [
  {
    schema: CompanyOnboardingSchema,
    base: onboardingBase,
    spec: { field: "industry", valid: "saas", invalid: "aerospace" },
  },
  {
    schema: CompanyOnboardingSchema,
    base: onboardingBase,
    spec: { field: "plan_tier", valid: "pro", invalid: "platinum" },
  },
  {
    schema: CreateInvitationSchema,
    base: inviteBase,
    spec: { field: "role", valid: "admin", invalid: "superadmin" },
  },
  {
    schema: RoleChangeSchema,
    base: roleBase,
    spec: { field: "role", valid: "admin", invalid: "owner" },
  },
  {
    schema: ReviewRequestSchema,
    base: reviewBase,
    spec: { field: "content_type", valid: "email", invalid: "blog" },
  },
  {
    schema: ReviewRequestSchema,
    base: reviewBase,
    spec: { field: "media_type", valid: "text", invalid: "video_short" },
  },
];

describe("input hardening — every enum input is a closed set", () => {
  for (const { schema, base, spec } of ENUM_CASES) {
    it(`${spec.field} accepts a known value and rejects an unknown one`, () => {
      const result = checkEnumClosed(parseOf(schema), setter(base, spec.field), spec);
      expect(result.failures).toEqual([]);
      expect(result.ok).toBe(true);
    });
  }
});

// ── Part 2: the specific size limits the sweep added (explicit regressions) ──

describe("input hardening — size-limit regressions", () => {
  it("bounds the free-form review platform", () => {
    expect(
      ReviewRequestSchema.safeParse({
        ...reviewBase,
        platform: "x".repeat(MAX_PLATFORM_CHARS),
      }).success,
    ).toBe(true);
    expect(
      ReviewRequestSchema.safeParse({
        ...reviewBase,
        platform: "x".repeat(MAX_PLATFORM_CHARS + 1),
      }).success,
    ).toBe(false);
  });

  it("trims a padded platform value (sanitization)", () => {
    const parsed = ReviewRequestSchema.safeParse({
      ...reviewBase,
      platform: "  instagram  ",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.platform).toBe("instagram");
  });

  it("bounds the credential email to the RFC ceiling", () => {
    expect(credentialsSchema.safeParse({ ...credBase, email: emailSample(MAX_EMAIL_CHARS) }).success).toBe(true);
    expect(credentialsSchema.safeParse({ ...credBase, email: emailSample(MAX_EMAIL_CHARS + 1) }).success).toBe(false);
  });

  it("still rejects an empty or malformed email", () => {
    expect(credentialsSchema.safeParse({ ...credBase, email: "" }).success).toBe(false);
    expect(credentialsSchema.safeParse({ ...credBase, email: "not-an-email" }).success).toBe(false);
  });

  it("bounds the password length (both floor and ceiling)", () => {
    expect(credentialsSchema.safeParse({ ...credBase, password: "a".repeat(MIN_PASSWORD_CHARS - 1) }).success).toBe(false);
    expect(credentialsSchema.safeParse({ ...credBase, password: "a".repeat(MAX_PASSWORD_CHARS) }).success).toBe(true);
    expect(credentialsSchema.safeParse({ ...credBase, password: "a".repeat(MAX_PASSWORD_CHARS + 1) }).success).toBe(false);
  });

  it("bounds the role-change target user id", () => {
    expect(RoleChangeSchema.safeParse({ ...roleBase, userId: "a".repeat(MAX_USER_ID_CHARS) }).success).toBe(true);
    expect(RoleChangeSchema.safeParse({ ...roleBase, userId: "a".repeat(MAX_USER_ID_CHARS + 1) }).success).toBe(false);
  });

  it("guards the invite token length before hashing", () => {
    expect(isWellFormedInviteToken("")).toBe(false);
    expect(isWellFormedInviteToken("a".repeat(64))).toBe(true); // a real 64-hex token
    expect(isWellFormedInviteToken("a".repeat(MAX_INVITE_TOKEN_CHARS))).toBe(true);
    expect(isWellFormedInviteToken("a".repeat(MAX_INVITE_TOKEN_CHARS + 1))).toBe(false);
  });
});

// ── Part 3: drift guard over the input-schema source files ───────────────────

function loadSchemaSource(relFromSrc: string): string {
  const abs = fileURLToPath(new URL(`../src/${relFromSrc}`, import.meta.url));
  return readFileSync(abs, "utf8");
}

describe("input hardening — drift guard over input-schema source", () => {
  const discovered = INPUT_SCHEMA_SOURCE_FILES.flatMap((f) =>
    findExportedSchemaNames(loadSchemaSource(f)),
  );

  it("discovers the real exported input schemas (scanner is not silently empty)", () => {
    expect(discovered).toContain("credentialsSchema");
    expect(discovered).toContain("BrandProfileSchema");
    expect(discovered.length).toBeGreaterThanOrEqual(AUDITED_INPUT_SCHEMAS.length);
  });

  it("every exported input schema is accounted for (no unaudited / stale)", () => {
    const { unaudited, missingFromSource } = reconcileAuditedSchemas(discovered);
    expect(unaudited).toEqual([]);
    expect(missingFromSource).toEqual([]);
  });
});
