import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { updateCompanyBilling } from "@/lib/db/queries";
import type { CompanyRow } from "@/types/db";

/**
 * Data-layer scoping for the Day 71 billing write. A minimal fake PostgREST
 * builder records the table, op, filters, and updated values so we can assert
 * `updateCompanyBilling` scopes to the passed company id and writes ONLY the keys
 * it was given (a partial update must never clobber columns the webhook owns) —
 * the same approach as tests/invitations-queries.test.ts. The full round-trip is
 * covered by scripts/db-smoke.ts.
 */

type QueryResult = { data: unknown; error: { message: string; code?: string } | null };

interface Recorded {
  table: string;
  op: "select" | "update";
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
  then<T1 = QueryResult, T2 = never>(
    onfulfilled?: ((value: QueryResult) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): Promise<T1 | T2> {
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

function companyRow(over: Partial<CompanyRow> = {}): CompanyRow {
  return {
    id: COMPANY_ID,
    name: "Acme",
    industry: null,
    plan_tier: "free",
    juror_weights: null,
    onboarded_at: null,
    created_at: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("updateCompanyBilling", () => {
  it("scopes the update to the passed company id", async () => {
    const { db, calls } = fakeDb(() => ({ data: companyRow(), error: null }));
    await updateCompanyBilling(db, COMPANY_ID, { stripe_customer_id: "cus_1" });
    const call = calls.find((c) => c.table === "companies");
    expect(call?.op).toBe("update");
    expect(call?.filters).toEqual({ id: COMPANY_ID });
  });

  it("writes only the keys provided (a partial update never clobbers other columns)", async () => {
    const { db, calls } = fakeDb(() => ({ data: companyRow(), error: null }));
    // Checkout writes just the customer id — status/periods must be left untouched.
    await updateCompanyBilling(db, COMPANY_ID, { stripe_customer_id: "cus_1" });
    expect(calls[0].values).toEqual({ stripe_customer_id: "cus_1" });
  });

  it("writes the full subscription mirror when the webhook hands it over", async () => {
    const { db, calls } = fakeDb(() => ({ data: companyRow(), error: null }));
    await updateCompanyBilling(db, COMPANY_ID, {
      stripe_subscription_id: "sub_1",
      subscription_status: "trialing",
      trial_ends_at: "2026-12-07T00:00:00.000Z",
      current_period_end: "2026-12-07T00:00:00.000Z",
    });
    expect(calls[0].values).toEqual({
      stripe_subscription_id: "sub_1",
      subscription_status: "trialing",
      trial_ends_at: "2026-12-07T00:00:00.000Z",
      current_period_end: "2026-12-07T00:00:00.000Z",
    });
  });

  it("maps an explicit null to a column clear (e.g. clearing a canceled subscription)", async () => {
    const { db, calls } = fakeDb(() => ({ data: companyRow(), error: null }));
    await updateCompanyBilling(db, COMPANY_ID, {
      stripe_subscription_id: null,
      subscription_status: null,
    });
    expect(calls[0].values).toEqual({
      stripe_subscription_id: null,
      subscription_status: null,
    });
  });

  it("surfaces a DB error with operation context (no silent failure)", async () => {
    const { db } = fakeDb(() => ({ data: null, error: { message: "boom", code: "XX000" } }));
    await expect(
      updateCompanyBilling(db, COMPANY_ID, { stripe_customer_id: "cus_1" }),
    ).rejects.toThrow(/updateCompanyBilling failed \[XX000\]: boom/);
  });
});
