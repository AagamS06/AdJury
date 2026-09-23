import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { insertBrandProfile, updateBrandProfile } from "@/lib/db/queries";
import type { BrandProfileRow } from "@/types/db";

/**
 * Data-layer scoping for the Day 26 brand-profile writes. A minimal fake
 * PostgREST builder records the op, filters, and written values so we can assert
 * `updateBrandProfile` scopes the update by BOTH `id` and `company_id` — the
 * multi-tenant safety guarantee that a write can never touch another company's
 * row even if handed a foreign id (Rules.md §5) — and bumps `updated_at`, and
 * that `insertBrandProfile` stores the company-scoped row. Mirrors
 * tests/user-role-query.test.ts.
 */

type QueryResult = { data: unknown; error: { message: string; code?: string } | null };

interface Recorded {
  table: string;
  op: "select" | "insert" | "update";
  filters: Record<string, unknown>;
  values: unknown;
}

class FakeBuilder implements PromiseLike<QueryResult> {
  op: Recorded["op"] = "select";
  filters: Record<string, unknown> = {};
  values: unknown = undefined;

  constructor(
    readonly table: string,
    private readonly resolve: (b: FakeBuilder) => QueryResult,
    private readonly record: (b: FakeBuilder) => void,
  ) {}

  select(): this {
    return this;
  }
  insert(values: unknown): this {
    this.op = "insert";
    this.values = values;
    return this;
  }
  update(values: unknown): this {
    this.op = "update";
    this.values = values;
    return this;
  }
  eq(col: string, val: unknown): this {
    this.filters[col] = val;
    return this;
  }
  single(): Promise<QueryResult> {
    return this.settle();
  }
  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?:
      | ((value: QueryResult) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.settle().then(onfulfilled, onrejected);
  }

  private settle(): Promise<QueryResult> {
    this.record(this);
    return Promise.resolve(this.resolve(this));
  }
}

function fakeDb(resolve: (b: FakeBuilder) => QueryResult) {
  const calls: Recorded[] = [];
  const record = (b: FakeBuilder) =>
    calls.push({ table: b.table, op: b.op, filters: b.filters, values: b.values });
  const db = {
    from: (table: string) => new FakeBuilder(table, resolve, record),
  } as unknown as SupabaseClient;
  return { db, calls };
}

const COMPANY_ID = "22222222-2222-2222-2222-222222222222";
const PROFILE_ID = "44444444-4444-4444-4444-444444444444";

function profileRow(): BrandProfileRow {
  return {
    id: PROFILE_ID,
    company_id: COMPANY_ID,
    tone_guide_text: "Measured, expert, never hype.",
    embedding_ref: null,
    updated_at: "2026-09-22T00:00:00.000Z",
  };
}

describe("updateBrandProfile query scoping", () => {
  it("updates the guide scoped by both id and company_id, bumping updated_at", async () => {
    const { db, calls } = fakeDb(() => ({ data: profileRow(), error: null }));

    const row = await updateBrandProfile(db, PROFILE_ID, COMPANY_ID, {
      tone_guide_text: "New guide.",
    });

    expect(row.company_id).toBe(COMPANY_ID);
    const call = calls.find((c) => c.op === "update");
    expect(call?.table).toBe("brand_profiles");
    // Tenancy: the write is scoped to the row AND the company.
    expect(call?.filters).toEqual({ id: PROFILE_ID, company_id: COMPANY_ID });
    const values = call?.values as Record<string, unknown>;
    expect(values.tone_guide_text).toBe("New guide.");
    expect(typeof values.updated_at).toBe("string");
    // embedding_ref is left untouched (brand-voice cache is Days 29–30).
    expect(values).not.toHaveProperty("embedding_ref");
  });

  it("throws with operation context (no PII) on a DB error", async () => {
    const { db } = fakeDb(() => ({
      error: { message: "permission denied", code: "42501" },
      data: null,
    }));

    await expect(
      updateBrandProfile(db, PROFILE_ID, COMPANY_ID, { tone_guide_text: "x" }),
    ).rejects.toThrow(/db\.updateBrandProfile failed \[42501\]/);
  });
});

describe("insertBrandProfile query", () => {
  it("inserts a company-scoped brand profile row", async () => {
    const { db, calls } = fakeDb(() => ({ data: profileRow(), error: null }));

    await insertBrandProfile(db, {
      company_id: COMPANY_ID,
      tone_guide_text: "First guide.",
    });

    const call = calls.find((c) => c.op === "insert");
    expect(call?.table).toBe("brand_profiles");
    const values = call?.values as Record<string, unknown>;
    expect(values.company_id).toBe(COMPANY_ID);
    expect(values.tone_guide_text).toBe("First guide.");
    expect(values.embedding_ref).toBeNull();
  });
});
