import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { provisionCompanyForNewUser } from "@/lib/auth/provisioning";

/**
 * Signup provisioning creates a company then its first admin user, rolling back
 * the company if the user insert fails (Rules.md §6 — no orphaned partial
 * state). Exercised here against a hand-rolled fake Supabase client so the
 * two-step write + rollback is covered without a live database (the full
 * round-trip is in scripts/db-smoke.ts).
 */
interface FakeState {
  deletedCompanyIds: string[];
  insertedCompany: Record<string, unknown> | null;
  insertedUser: Record<string, unknown> | null;
}

function makeFakeClient(opts: { failUserInsert?: boolean } = {}): {
  db: SupabaseClient;
  state: FakeState;
} {
  const state: FakeState = {
    deletedCompanyIds: [],
    insertedCompany: null,
    insertedUser: null,
  };

  const db = {
    from(table: string) {
      return {
        insert(values: Record<string, unknown>) {
          return {
            select() {
              return {
                async single() {
                  if (table === "companies") {
                    const row = {
                      id: "company-1",
                      name: values.name,
                      industry: values.industry ?? null,
                      plan_tier: values.plan_tier ?? "free",
                      created_at: "2026-08-30T00:00:00Z",
                    };
                    state.insertedCompany = row;
                    return { data: row, error: null };
                  }
                  if (table === "users") {
                    if (opts.failUserInsert) {
                      return {
                        data: null,
                        error: { message: "insert failed", code: "23505" },
                      };
                    }
                    const row = {
                      id: values.id,
                      company_id: values.company_id,
                      email: values.email,
                      role: values.role,
                      created_at: "2026-08-30T00:00:00Z",
                    };
                    state.insertedUser = row;
                    return { data: row, error: null };
                  }
                  return { data: null, error: { message: `unexpected table ${table}` } };
                },
              };
            },
          };
        },
        delete() {
          return {
            async eq(_column: string, value: string) {
              if (table === "companies") state.deletedCompanyIds.push(value);
              return { data: null, error: null };
            },
          };
        },
      };
    },
  } as unknown as SupabaseClient;

  return { db, state };
}

describe("provisionCompanyForNewUser", () => {
  const PARAMS = {
    userId: "auth-user-1",
    email: "admin@acme.com",
    companyName: "Acme Marketing",
  };

  it("creates the company and its first admin user", async () => {
    const { db, state } = makeFakeClient();

    const { company, user } = await provisionCompanyForNewUser(db, PARAMS);

    expect(company.id).toBe("company-1");
    expect(company.name).toBe("Acme Marketing");
    expect(user.id).toBe("auth-user-1");
    expect(user.company_id).toBe("company-1");
    expect(user.role).toBe("admin");
    expect(state.deletedCompanyIds).toEqual([]);
  });

  it("rolls back the company when the admin-user insert fails", async () => {
    const { db, state } = makeFakeClient({ failUserInsert: true });

    await expect(provisionCompanyForNewUser(db, PARAMS)).rejects.toThrow();

    expect(state.insertedCompany).not.toBeNull();
    expect(state.insertedUser).toBeNull();
    // The orphaned company must be deleted so signup can be retried cleanly.
    expect(state.deletedCompanyIds).toEqual(["company-1"]);
  });
});
