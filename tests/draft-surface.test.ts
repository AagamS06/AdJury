import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DraftRequestSchema,
  DraftResultSchema,
  MAX_CONSTRAINT_ITEMS,
  MAX_DRAFT_VARIANTS,
} from "@/lib/draft/draft-assistant";
import { buildDraftAssistantReadiness } from "@/lib/draft/draft-assistant-readiness";
import {
  NAV_ITEMS,
  activeNavKey,
  navItemsForRole,
  isNavItemActive,
} from "@/lib/ui/nav";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const coreSource = readFileSync(`${repoRoot}src/lib/draft/draft-assistant.ts`, "utf8");
const PAGE_PATH = `${repoRoot}src/app/(dashboard)/draft/page.tsx`;
const ROUTE_PATH = `${repoRoot}src/app/api/draft/route.ts`;
const CREATE_PATH = `${repoRoot}src/lib/draft/create-draft.ts`;

/** A valid request body (the client contract). */
function reqBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    product: "a weighted blanket",
    audience: "tired people",
    keyMessage: "sleep better",
    tone: "empathetic",
    content_type: "ad_copy",
    ...overrides,
  };
}

describe("DraftRequestSchema — boundary contract", () => {
  it("accepts a minimal brief and defaults platform→null and the constraint lists→[]", () => {
    const parsed = DraftRequestSchema.safeParse(reqBody({ variants: 2 }));
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.platform).toBeNull();
      expect(parsed.data.mustInclude).toEqual([]);
      expect(parsed.data.mustAvoid).toEqual([]);
    }
  });

  it("maps an empty/whitespace platform string to null", () => {
    const parsed = DraftRequestSchema.safeParse(reqBody({ variants: 1, platform: "   " }));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.platform).toBeNull();
  });

  it("rejects an unknown tone and an unknown content type (closed enums)", () => {
    expect(DraftRequestSchema.safeParse(reqBody({ variants: 1, tone: "sarcastic" })).success).toBe(false);
    expect(DraftRequestSchema.safeParse(reqBody({ variants: 1, content_type: "billboard" })).success).toBe(false);
  });

  it("rejects a non-integer / out-of-range variant count", () => {
    expect(DraftRequestSchema.safeParse(reqBody({ variants: 0 })).success).toBe(false);
    expect(DraftRequestSchema.safeParse(reqBody({ variants: MAX_DRAFT_VARIANTS + 1 })).success).toBe(false);
    expect(DraftRequestSchema.safeParse(reqBody({ variants: 2.5 })).success).toBe(false);
    expect(DraftRequestSchema.safeParse(reqBody({ variants: "3" })).success).toBe(false);
  });

  it("bounds the constraint lists so a greedy payload can't blow the budget", () => {
    const tooMany = Array.from({ length: MAX_CONSTRAINT_ITEMS + 1 }, (_, i) => `item ${i}`);
    expect(DraftRequestSchema.safeParse(reqBody({ variants: 1, mustInclude: tooMany })).success).toBe(false);
  });

  it("trims the free-text fields", () => {
    const parsed = DraftRequestSchema.safeParse(reqBody({ variants: 1, product: "  a blanket  " }));
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.product).toBe("a blanket");
  });
});

describe("DraftResultSchema — response contract", () => {
  it("accepts a well-formed result and rejects a result with a malformed draft", () => {
    const good = {
      brief: reqBody({ variants: 1, platform: null, mustInclude: [], mustAvoid: [] }),
      drafts: [{ variantLabel: "Variant A", angle: "benefit-led", headline: "H", body: "B", cta: "Go" }],
      generator: "offline",
      disclaimer: "x",
    };
    expect(DraftResultSchema.safeParse(good).success).toBe(true);

    const bad = { ...good, drafts: [{ variantLabel: "", angle: "", headline: "", body: "", cta: "" }] };
    expect(DraftResultSchema.safeParse(bad).success).toBe(false);
  });
});

describe("Draft Assistant readiness — the Day-89 surface is tracked, not assumed", () => {
  it("reports the surface as READY only when the real page + route ship and carry no jury coupling", () => {
    const surfaceSources = [ROUTE_PATH, CREATE_PATH].map((p) => readFileSync(p, "utf8"));
    const r = buildDraftAssistantReadiness(coreSource, undefined, {
      pageExists: existsSync(PAGE_PATH),
      routeExists: existsSync(ROUTE_PATH),
      surfaceSources,
    });
    const surfaceItem = r.items.find((i) => i.title.includes("/draft route"));
    expect(surfaceItem?.status).toBe("ready");
    // With the surface shipped, only the live model key remains manual.
    expect(r.manualSteps).toBe(1);
    expect(r.ready).toBe(true);
  });

  it("falls back to MANUAL when the surface evidence is absent (never assumes it shipped)", () => {
    const r = buildDraftAssistantReadiness(coreSource);
    const surfaceItem = r.items.find((i) => i.title.includes("/draft route"));
    expect(surfaceItem?.status).toBe("manual");
    expect(r.manualSteps).toBe(2);
  });

  it("flags the surface as coupled if a surface module imports the jury (non-vacuous guard)", () => {
    const r = buildDraftAssistantReadiness(coreSource, undefined, {
      pageExists: true,
      routeExists: true,
      surfaceSources: ['import { runReview } from "@/lib/ai/orchestrator";'],
    });
    const surfaceItem = r.items.find((i) => i.title.includes("/draft route"));
    expect(surfaceItem?.status).toBe("manual");
    expect(surfaceItem?.detail).toMatch(/COUPLED/);
  });
});

describe("Draft Assistant nav entry (DailyPlan Day 89)", () => {
  const draft = NAV_ITEMS.find((i) => i.key === "draft");

  it("adds a Draft assistant item to the workspace, open to members (not admin-only)", () => {
    expect(draft).toBeDefined();
    expect(draft?.href).toBe("/draft");
    expect(draft?.section).toBe("workspace");
    expect(draft?.adminOnly).toBeFalsy();
    expect(navItemsForRole("member").some((i) => i.key === "draft")).toBe(true);
  });

  it("the nav href points at a real page directory (surface actually ships)", () => {
    expect(existsSync(PAGE_PATH)).toBe(true);
  });

  it("lights exactly the Draft item on /draft, and leaves /review on New review", () => {
    expect(activeNavKey(NAV_ITEMS, "/draft")).toBe("draft");
    expect(activeNavKey(NAV_ITEMS, "/review")).toBe("review");
    // Exactly one active item for the /draft route.
    expect(NAV_ITEMS.filter((i) => isNavItemActive(i, "/draft"))).toHaveLength(1);
  });
});
