import { describe, it, expect } from "vitest";
import {
  parseListField,
  submitDraft,
  validateDraftForm,
  VARIANT_OPTIONS,
  TONE_OPTIONS,
  DRAFT_CONTENT_TYPE_OPTIONS,
  type DraftFormFields,
} from "@/lib/draft/draft-form";
import {
  DRAFT_DISCLAIMER,
  MAX_DRAFT_VARIANTS,
  MIN_DRAFT_VARIANTS,
  type DraftRequest,
  type DraftResult,
} from "@/lib/draft/draft-assistant";

/**
 * Client-side form logic for `/draft` (DailyPlan Day 89), tested in the node env
 * (no jsdom) with an injected fetch. Mirrors the review-form test.
 */

function fields(overrides: Partial<DraftFormFields> = {}): DraftFormFields {
  return {
    product: "a weighted blanket",
    audience: "people who struggle to switch off at night",
    keyMessage: "fall asleep faster and wake up less",
    tone: "empathetic",
    content_type: "ad_copy",
    platform: "instagram",
    mustInclude: "Free returns",
    mustAvoid: "cure",
    variants: "3",
    ...overrides,
  };
}

describe("parseListField", () => {
  it("splits on newlines and commas, trims, and drops blanks", () => {
    expect(parseListField("Free returns\n30-day trial")).toEqual(["Free returns", "30-day trial"]);
    expect(parseListField("a, b ,  , c")).toEqual(["a", "b", "c"]);
    expect(parseListField("\n\n")).toEqual([]);
    expect(parseListField("")).toEqual([]);
  });
});

describe("option lists", () => {
  it("offers exactly the MIN..MAX variant range", () => {
    expect(VARIANT_OPTIONS[0]).toBe(MIN_DRAFT_VARIANTS);
    expect(VARIANT_OPTIONS[VARIANT_OPTIONS.length - 1]).toBe(MAX_DRAFT_VARIANTS);
    expect(VARIANT_OPTIONS).toHaveLength(MAX_DRAFT_VARIANTS - MIN_DRAFT_VARIANTS + 1);
  });

  it("covers the closed tone and content-type vocabularies", () => {
    expect(TONE_OPTIONS).toHaveLength(6);
    expect(DRAFT_CONTENT_TYPE_OPTIONS.map((o) => o.value)).toEqual([
      "ad_copy",
      "social_post",
      "email",
      "landing_page",
    ]);
  });
});

describe("validateDraftForm", () => {
  it("accepts a well-formed brief, parsing list fields and keeping the platform", () => {
    const v = validateDraftForm(fields());
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.data.mustInclude).toEqual(["Free returns"]);
      expect(v.data.mustAvoid).toEqual(["cure"]);
      expect(v.data.platform).toBe("instagram");
      expect(v.data.variants).toBe(3);
    }
  });

  it("maps an empty platform to null", () => {
    const v = validateDraftForm(fields({ platform: "   " }));
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.data.platform).toBeNull();
  });

  it("parses multi-line must-include / must-avoid into arrays", () => {
    const v = validateDraftForm(fields({ mustInclude: "Free returns\n30-day trial", mustAvoid: "" }));
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.data.mustInclude).toEqual(["Free returns", "30-day trial"]);
      expect(v.data.mustAvoid).toEqual([]);
    }
  });

  it("flags a missing product with a per-field error", () => {
    const v = validateDraftForm(fields({ product: "  " }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.fieldErrors.product).toBeTruthy();
  });

  it("flags an unselected tone and content type", () => {
    const v = validateDraftForm(fields({ tone: "", content_type: "" }));
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.fieldErrors.tone).toMatch(/tone/i);
      expect(v.fieldErrors.content_type).toMatch(/type/i);
    }
  });

  it("never returns an empty error map on failure (UI never shows a blank error)", () => {
    const v = validateDraftForm(fields({ product: "", audience: "", keyMessage: "" }));
    expect(v.ok).toBe(false);
    if (!v.ok) expect(Object.keys(v.fieldErrors).length).toBeGreaterThan(0);
  });
});

/** Build a fake fetch returning a given status + JSON payload. */
function fakeFetch(status: number, payload: unknown): typeof fetch {
  return (async () =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;
}

const REQUEST: DraftRequest = {
  product: "a weighted blanket",
  audience: "tired people",
  keyMessage: "sleep better",
  tone: "empathetic",
  content_type: "ad_copy",
  platform: null,
  mustInclude: [],
  mustAvoid: [],
  variants: 2,
};

const RESULT: DraftResult = {
  brief: REQUEST,
  drafts: [
    { variantLabel: "Variant A", angle: "benefit-led", headline: "Sleep better", body: "A weighted blanket for tired people.", cta: "Learn more" },
    { variantLabel: "Variant B", angle: "problem-solution", headline: "For tired people", body: "Sleep better, tonight.", cta: "See how it works" },
  ],
  generator: "offline",
  disclaimer: DRAFT_DISCLAIMER,
};

describe("submitDraft", () => {
  it("returns the validated result on a 200", async () => {
    const out = await submitDraft(REQUEST, fakeFetch(200, RESULT));
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.result.drafts).toHaveLength(2);
      expect(out.result.generator).toBe("offline");
    }
  });

  it("surfaces a server error message on a non-2xx", async () => {
    const out = await submitDraft(REQUEST, fakeFetch(400, { error: "Add the product to draft ad copy." }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toMatch(/product/i);
  });

  it("treats a malformed success payload as an error (never rendered as drafts)", async () => {
    const out = await submitDraft(REQUEST, fakeFetch(200, { drafts: "nope" }));
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toMatch(/unexpected/i);
  });

  it("maps a network throw to a friendly message", async () => {
    const throwing = (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    const out = await submitDraft(REQUEST, throwing);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.message).toMatch(/network/i);
  });
});
