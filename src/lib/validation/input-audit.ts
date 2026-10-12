/**
 * Input-hardening audit (DailyPlan Day 45 — Week 7 security pass).
 *
 * "Validation/sanitization + size-limit sweep on all inputs. DoD: malformed/
 * oversized inputs rejected cleanly."
 *
 * The companion to Day 43's RLS audit and Day 44's authz audit. Where those
 * proved the DATABASE- and APPLICATION-layer *tenancy* postures, this proves the
 * INPUT posture of every user-supplied field: each one is validated at the
 * boundary with an explicit, bounded contract, so an empty, oversized, or
 * wrong-typed value is rejected cleanly (Rules.md §3 validate-before-trust; §6
 * reject bad input at the boundary with a specific message; §1 cost discipline —
 * an unbounded free-text field slips past the content/token caps).
 *
 * Two pure, node-testable surfaces so the invariant is provable offline with no
 * Next request plumbing and no live database:
 *
 *  1. BOUND-CHECK HELPERS (`checkStringBound`, `checkEnumClosed`) — generic
 *     property checks a test runs over every input schema's fields: a bounded
 *     string accepts a max-length value and rejects one character over (and, when
 *     it has a floor, rejects one under), rejects a non-string, and honours its
 *     optional/nullable posture; a closed enum accepts a known value and rejects
 *     an unknown one and a non-string. These drive the REAL schemas, so they
 *     prove the DoD rather than restating it.
 *
 *  2. A DRIFT SCANNER (`findExportedSchemaNames` / `reconcileAuditedSchemas`)
 *     over the dedicated input-schema source files. Every exported `*Schema` in
 *     those files must be listed in `AUDITED_INPUT_SCHEMAS`, so a NEW input
 *     schema cannot ship without being added to the audit (the same drift guard
 *     as Day 43's `POLICY_POSTURE` and Day 44's endpoint inventory).
 *
 * Scope note: the review input schemas (`ReviewInputSchema` / `ReviewRequestSchema`
 * in `schema/juror.ts`) are audited by direct bound-check entries in the test,
 * but `juror.ts` is intentionally NOT in `INPUT_SCHEMA_SOURCE_FILES` — it also
 * holds the MODEL-OUTPUT contract (`IssueSchema` / `JurorResultSchema` /
 * `ReviewResultSchema`), which is validated model output, not user input, and is
 * bounded by the per-juror output-token ceiling and covered by the schema/
 * orchestrator suites. Mixing it into the source scan would conflate the two.
 */

/** A schema's `.safeParse`, narrowed to what the checks need. */
export type SafeParse = (input: unknown) => { success: boolean };

/** Build a full candidate object with the audited field set to `value`. */
export type BuildCandidate = (value: unknown) => unknown;

/** Default valid-value generator: a run of ASCII letters of the given length. */
export function defaultSample(len: number): string {
  return "a".repeat(Math.max(0, len));
}

/**
 * Valid-email generator of (approximately) the given total length — a long local
 * part plus a fixed `@e.co` domain — so an email field's length bound can be
 * probed with values that pass the format check and fail only on length.
 */
export function emailSample(len: number): string {
  const domain = "@e.co";
  const local = Math.max(1, len - domain.length);
  return `${"a".repeat(local)}${domain}`;
}

/** The bound contract for one string field, and how to probe it. */
export interface StringBoundSpec {
  field: string;
  /** Maximum accepted length: this length is accepted, one more is rejected. */
  max: number;
  /** Minimum accepted length, if the field has a floor (this is accepted, one less rejected). */
  min?: number;
  /** The field may be omitted (optional or has a default). */
  optional?: boolean;
  /** The field accepts `null`. */
  nullable?: boolean;
  /** Valid-value generator for a target length; defaults to {@link defaultSample}. */
  sample?: (len: number) => string;
}

export interface BoundAuditResult {
  field: string;
  ok: boolean;
  /** One line per expectation that did not hold (empty == clean). */
  failures: string[];
}

/**
 * Probe one bounded string field against its spec. Pure: the schema's
 * `.safeParse` and the candidate builder are injected, so a test can run it over
 * every input schema without any request plumbing.
 */
export function checkStringBound(
  parse: SafeParse,
  build: BuildCandidate,
  spec: StringBoundSpec,
): BoundAuditResult {
  const sample = spec.sample ?? defaultSample;
  const failures: string[] = [];
  const expect = (cond: boolean, msg: string) => {
    if (!cond) failures.push(msg);
  };

  // Accepts a value exactly at the maximum; rejects one character over.
  expect(parse(build(sample(spec.max))).success, `rejects a valid ${spec.max}-char value`);
  expect(
    !parse(build(sample(spec.max + 1))).success,
    `accepts an oversized ${spec.max + 1}-char value (max is ${spec.max})`,
  );

  // Honours a minimum-length floor, when the field has one.
  if (spec.min !== undefined) {
    expect(parse(build(sample(spec.min))).success, `rejects a valid ${spec.min}-char value`);
    if (spec.min - 1 >= 0) {
      expect(
        !parse(build(sample(spec.min - 1))).success,
        `accepts a too-short ${spec.min - 1}-char value (min is ${spec.min})`,
      );
    }
  }

  // A non-string is never a valid string field.
  expect(!parse(build(123)).success, "accepts a non-string value");

  // Optional/nullable posture: an absent or null value is accepted only when the
  // contract says so, and rejected otherwise (fail closed on a required field).
  expect(
    parse(build(undefined)).success === Boolean(spec.optional),
    spec.optional
      ? "rejects an omitted optional field"
      : "accepts an omitted required field",
  );
  expect(
    parse(build(null)).success === Boolean(spec.nullable),
    spec.nullable ? "rejects a null nullable field" : "accepts a null for a non-nullable field",
  );

  return { field: spec.field, ok: failures.length === 0, failures };
}

/** The closed-set contract for one enum field. */
export interface EnumClosedSpec {
  field: string;
  /** A value the enum accepts. */
  valid: string;
  /** A value the enum must reject (not in the set). */
  invalid: string;
}

/**
 * Probe one enum field: a known value is accepted, an unknown value and a
 * non-string are rejected — so the field is a genuinely closed set, not an open
 * string in disguise.
 */
export function checkEnumClosed(
  parse: SafeParse,
  build: BuildCandidate,
  spec: EnumClosedSpec,
): BoundAuditResult {
  const failures: string[] = [];
  const expect = (cond: boolean, msg: string) => {
    if (!cond) failures.push(msg);
  };
  expect(parse(build(spec.valid)).success, `rejects the known value "${spec.valid}"`);
  expect(!parse(build(spec.invalid)).success, `accepts the unknown value "${spec.invalid}"`);
  expect(!parse(build(123)).success, "accepts a non-string value");
  return { field: spec.field, ok: failures.length === 0, failures };
}

// ── Drift scanner over the input-schema source files ─────────────────────────

/**
 * The source files whose exported input schemas this audit covers, relative to
 * `src`. Each holds the Zod contract for a user-facing form/endpoint input.
 * `schema/juror.ts` is deliberately excluded (see the module header): it mixes
 * user input with the model-output contract, which is audited elsewhere.
 */
export const INPUT_SCHEMA_SOURCE_FILES = [
  "lib/auth/schema.ts",
  "lib/company/onboarding.ts",
  "lib/company/invitations.ts",
  "lib/company/role-management.ts",
  "lib/company/brand-profile.ts",
] as const;

/**
 * Every exported `*Schema` the audit accounts for. The test reconciles this
 * against what is actually exported from `INPUT_SCHEMA_SOURCE_FILES`, so a newly
 * added input schema forces an entry here (and thus a bound-check entry) rather
 * than silently escaping the sweep.
 */
export const AUDITED_INPUT_SCHEMAS = [
  "credentialsSchema",
  "signUpSchema",
  "CompanyOnboardingSchema",
  "CreateInvitationSchema",
  "RoleChangeSchema",
  "BrandProfileSchema",
] as const;

/** Strip line and block comments so a commented-out schema can't match. */
export function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const EXPORTED_SCHEMA_RE = /export\s+const\s+(\w+Schema)\s*=/g;

/** Names of the exported `*Schema` constants declared in a source file. */
export function findExportedSchemaNames(rawSrc: string): string[] {
  const src = stripComments(rawSrc);
  const found = new Set<string>();
  for (const m of src.matchAll(EXPORTED_SCHEMA_RE)) {
    found.add(m[1]);
  }
  return [...found].sort();
}

export interface SchemaReconciliation {
  /** Exported `*Schema` names found on disk but absent from the audit. */
  unaudited: string[];
  /** Audited names not found in any scanned source file (stale entries). */
  missingFromSource: string[];
}

/**
 * Reconcile the declared `AUDITED_INPUT_SCHEMAS` against the schema names
 * discovered across the input-schema source files. A clean result (both arrays
 * empty) means every exported input schema is audited and every audited name
 * still exists — so a new input schema can't dodge the sweep, and a renamed/
 * removed one can't leave a dangling audit entry.
 */
export function reconcileAuditedSchemas(
  discovered: readonly string[],
): SchemaReconciliation {
  const onDisk = new Set(discovered);
  const audited = new Set<string>(AUDITED_INPUT_SCHEMAS);
  const unaudited = [...onDisk].filter((n) => !audited.has(n)).sort();
  const missingFromSource = [...audited].filter((n) => !onDisk.has(n)).sort();
  return { unaudited, missingFromSource };
}
