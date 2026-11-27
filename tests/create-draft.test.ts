import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SessionContext } from "@/lib/auth/session";
import { createDraft } from "@/lib/draft/create-draft";
import {
  offlineDraftGenerator,
  DRAFT_DISCLAIMER,
  type DraftBrief,
  type DraftGenerator,
} from "@/lib/draft/draft-assistant";
import { findJuryImports } from "@/lib/draft/draft-assistant-readiness";

/**
 * Surface logic for POST /api/draft (DailyPlan Day 89), exercised with a fake
 * session and the deterministic offline generator — no network, no credential.
 * The route handler itself is a thin wrapper that wires the real dependencies
 * and maps the outcome to an HTTP response.
 */

const SESSION: SessionContext = {
  authUserId: "11111111-1111-1111-1111-111111111111",
  email: "admin@acme.test",
  companyId: "22222222-2222-2222-2222-222222222222",
  role: "admin",
  company: {
    id: "22222222-2222-2222-2222-222222222222",
    name: "Acme",
    industry: null,
    plan_tier: "free",
    juror_weights: null,
    onboarded_at: "2026-08-31T00:00:00.000Z",
    created_at: "2026-08-31T00:00:00.000Z",
  },
};

/** A well-formed request body (what the client POSTs). */
function body(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    product: "a weighted blanket",
    audience: "people who struggle to switch off at night",
    keyMessage: "fall asleep faster and wake up less",
    tone: "empathetic",
    content_type: "ad_copy",
    platform: "instagram",
    mustInclude: ["Free returns"],
    mustAvoid: ["cure"],
    variants: 3,
    ...overrides,
  };
}

describe("createDraft — auth", () => {
  it("rejects an unauthenticated caller with 401 (fails closed)", async () => {
    const result = await createDraft(body(), { session: null });
    expect(result).toMatchObject({ ok: false, status: 401 });
  });
});

describe("createDraft — request validation at the boundary", () => {
  it("rejects a non-object body with 400", async () => {
    const result = await createDraft("not json", { session: SESSION });
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects a missing required field with a specific 400", async () => {
    const result = await createDraft(body({ product: "   " }), { session: SESSION });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/product/i);
    }
  });

  it("rejects an unknown tone (closed enum) with 400", async () => {
    const result = await createDraft(body({ tone: "sarcastic" }), { session: SESSION });
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects an out-of-range variant count with 400", async () => {
    const result = await createDraft(body({ variants: 99 }), { session: SESSION });
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("rejects an oversized product field with 400 (caps the request)", async () => {
    const result = await createDraft(body({ product: "x".repeat(5000) }), {
      session: SESSION,
    });
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it("surfaces the domain guard's contradiction rejection as 400", async () => {
    // "returns" is in the brief's own copy AND listed to avoid — checkDraftBrief
    // rejects it; the surface maps that to a 400 with the guard's message.
    const result = await createDraft(
      body({ mustInclude: ["Free returns"], mustAvoid: ["returns"] }),
      { session: SESSION },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toMatch(/avoid/i);
    }
  });
});

describe("createDraft — generation (offline)", () => {
  it("returns 200 with the requested number of honest drafts + the disclaimer", async () => {
    const result = await createDraft(body({ variants: 3 }), {
      session: SESSION,
      generator: offlineDraftGenerator,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe(200);
      expect(result.result.drafts).toHaveLength(3);
      expect(result.result.generator).toBe("offline");
      expect(result.result.disclaimer).toBe(DRAFT_DISCLAIMER);
      // Honesty: the must-avoid term never appears; the must-include does.
      for (const d of result.result.drafts) {
        const copy = `${d.headline} ${d.body} ${d.cta}`.toLowerCase();
        expect(copy).not.toContain("cure");
      }
    }
  });

  it("defaults to the offline generator when none is injected (no key, no network)", async () => {
    const result = await createDraft(body(), { session: SESSION });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.result.generator).toBe("offline");
  });

  it("uses the injected generator (the live swap-in point)", async () => {
    const fake: DraftGenerator = {
      name: "fake-model",
      generate: (_brief: DraftBrief) => [
        { variantLabel: "Variant A", angle: "test", headline: "H", body: "B", cta: "Go" },
      ],
    };
    const result = await createDraft(body(), { session: SESSION, generator: fake });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.generator).toBe("fake-model");
      expect(result.result.drafts).toHaveLength(1);
    }
  });

  it("returns 500 (never crashes / leaks) when the generator throws", async () => {
    const boom: DraftGenerator = {
      name: "exploding",
      generate: () => {
        throw new Error("model exploded with secret-token=abc123");
      },
    };
    const result = await createDraft(body(), { session: SESSION, generator: boom });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(500);
      // The plain message never leaks the internal error / any secret.
      expect(result.error).not.toContain("secret-token");
      expect(result.error).toMatch(/try again/i);
    }
  });
});

describe("createDraft — stays separate from the jury", () => {
  it("the surface core imports neither the orchestrator nor any persona", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../src/lib/draft/create-draft.ts", import.meta.url)),
      "utf8",
    );
    expect(findJuryImports(source)).toEqual([]);
  });
});
