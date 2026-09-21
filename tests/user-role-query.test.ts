import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { updateUserRole } from "@/lib/db/queries";
import type { UserRow } from "@/types/db";

/**
 * Data-layer scoping for the Day 25 role-change write. A minimal fake PostgREST
 * builder records the op, filters, and updated values so we can assert
 * `updateUserRole` scopes the update by BOTH `id` and `company_id` — the
 * multi-tenant safety guarantee that a service-role write can never touch a
 * user in another company (Rules.md §5). Mirrors tests/invitations-queries.ts.
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
const USER_ID = "33333333-3333-3333-3333-333333333333";

function memberRow(role: "admin" | "member"): UserRow {
  return {
    id: USER_ID,
    company_id: COMPANY_ID,
    email: "member@acme.test",
    role,
    created_at: "2026-09-01T00:00:00.000Z",
  };
}

describe("updateUserRole query scoping", () => {
  it("updates role scoped by both id and company_id", async () => {
    const { db, calls } = fakeDb(() => ({ data: memberRow("admin"), error: null }));

    const row = await updateUserRole(db, COMPANY_ID, USER_ID, "admin");

    expect(row.role).toBe("admin");
    const call = calls.find((c) => c.op === "update");
    expect(call?.table).toBe("users");
    expect(call?.values).toEqual({ role: "admin" });
    // Tenancy: the write is scoped to the user AND the company.
    expect(call?.filters).toEqual({ id: USER_ID, company_id: COMPANY_ID });
  });

  it("throws with operation context (no PII) on a DB error", async () => {
    const { db } = fakeDb(() => ({
      error: { message: "permission denied", code: "42501" },
      data: null,
    }));

    await expect(updateUserRole(db, COMPANY_ID, USER_ID, "member")).rejects.toThrow(
      /db\.updateUserRole failed \[42501\]/,
    );
  });
});
