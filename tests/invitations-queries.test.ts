import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  findCompanyMemberByEmail,
  getInvitationByTokenHash,
  insertInvitation,
  listInvitationsByCompany,
  markInvitationAccepted,
} from "@/lib/db/queries";
import type { InvitationRow } from "@/types/db";

/**
 * Data-layer scoping for the Day 24 invitation queries. A minimal fake PostgREST
 * builder records the table, op, filters, and inserted/updated values so we can
 * assert each helper applies the tenancy filter it is handed and writes the
 * expected columns — the same approach as tests/reviews-tenancy.test.ts. The
 * full round-trip against a real DB is covered by scripts/db-smoke.ts.
 */

type QueryResult = { data: unknown; error: { message: string; code?: string } | null };

interface Recorded {
  table: string;
  op: "select" | "insert" | "update";
  filters: Record<string, unknown>;
  ilikeFilters: Record<string, unknown>;
  values: unknown;
}

class FakeBuilder implements PromiseLike<QueryResult> {
  op: Recorded["op"] = "select";
  filters: Record<string, unknown> = {};
  ilikeFilters: Record<string, unknown> = {};
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
  ilike(col: string, val: unknown): this {
    this.ilikeFilters[col] = val;
    return this;
  }
  order(): this {
    return this;
  }
  limit(): this {
    return this;
  }
  maybeSingle(): Promise<QueryResult> {
    return this.settle();
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
    calls.push({
      table: b.table,
      op: b.op,
      filters: b.filters,
      ilikeFilters: b.ilikeFilters,
      values: b.values,
    });
  const db = {
    from: (table: string) => new FakeBuilder(table, resolve, record),
  } as unknown as SupabaseClient;
  return { db, calls };
}

const COMPANY_ID = "22222222-2222-2222-2222-222222222222";

function invitationRow(): InvitationRow {
  return {
    id: "inv-1",
    company_id: COMPANY_ID,
    email: "invitee@acme.test",
    role: "member",
    token_hash: "deadbeef",
    status: "pending",
    invited_by: "11111111-1111-1111-1111-111111111111",
    expires_at: "2026-09-27T00:00:00.000Z",
    accepted_at: null,
    created_at: "2026-09-20T00:00:00.000Z",
  };
}

describe("invitation query scoping", () => {
  it("getInvitationByTokenHash filters by token_hash only", async () => {
    const { db, calls } = fakeDb(() => ({ data: invitationRow(), error: null }));
    await getInvitationByTokenHash(db, "deadbeef");
    const call = calls.find((c) => c.table === "invitations");
    expect(call?.filters).toEqual({ token_hash: "deadbeef" });
  });

  it("listInvitationsByCompany filters by company_id", async () => {
    const { db, calls } = fakeDb(() => ({ data: [invitationRow()], error: null }));
    await listInvitationsByCompany(db, COMPANY_ID);
    const call = calls.find((c) => c.table === "invitations");
    expect(call?.filters).toEqual({ company_id: COMPANY_ID });
  });

  it("findCompanyMemberByEmail scopes by company_id and matches email case-insensitively", async () => {
    const { db, calls } = fakeDb(() => ({ data: null, error: null }));
    await findCompanyMemberByEmail(db, COMPANY_ID, "Person@Acme.test");
    const call = calls.find((c) => c.table === "users");
    expect(call?.filters).toEqual({ company_id: COMPANY_ID });
    expect(call?.ilikeFilters).toEqual({ email: "Person@Acme.test" });
  });

  it("insertInvitation writes a pending row with the hash, never a raw token", async () => {
    const { db, calls } = fakeDb(() => ({ data: invitationRow(), error: null }));
    await insertInvitation(db, {
      company_id: COMPANY_ID,
      email: "invitee@acme.test",
      role: "member",
      token_hash: "deadbeef",
      invited_by: "11111111-1111-1111-1111-111111111111",
      expires_at: "2026-09-27T00:00:00.000Z",
    });
    const call = calls.find((c) => c.op === "insert");
    expect(call?.values).toMatchObject({
      company_id: COMPANY_ID,
      token_hash: "deadbeef",
      status: "pending",
    });
  });

  it("markInvitationAccepted updates status + accepted_at scoped by id", async () => {
    const { db, calls } = fakeDb(() => ({
      data: { ...invitationRow(), status: "accepted" },
      error: null,
    }));
    await markInvitationAccepted(db, "inv-1", new Date("2026-09-21T00:00:00.000Z"));
    const call = calls.find((c) => c.op === "update");
    expect(call?.filters).toEqual({ id: "inv-1" });
    expect(call?.values).toEqual({
      status: "accepted",
      accepted_at: "2026-09-21T00:00:00.000Z",
    });
  });
});
