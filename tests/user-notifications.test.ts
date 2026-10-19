import { describe, it, expect, vi } from "vitest";
import type { SessionContext } from "@/lib/auth/session";
import {
  DEFAULT_NOTIFICATION_PREFS,
  NotificationPrefsSchema,
  notificationPrefsEqual,
  resolveNotificationPrefs,
} from "@/lib/user/profile";
import { updateNotificationPreferences } from "@/lib/user/update-notifications";
import type {
  CompanyRow,
  NotificationPreferences,
  UserRole,
  UserRow,
} from "@/types/db";

/**
 * User notification preferences (DailyPlan Day 51, Part 2). Tests the pure prefs
 * contract + resolver and the injectable update core. The central guarantees are
 * the same as the profile core — authz + tenancy + idempotency: only a signed-in
 * user may save (401), the write is scoped to the session's own id + company id,
 * unchanged prefs are a no-op, and a malformed payload is rejected (400).
 */

const COMPANY_ID = "22222222-2222-2222-2222-222222222222";
const USER_ID = "11111111-1111-1111-1111-111111111111";

function companyRow(): CompanyRow {
  return {
    id: COMPANY_ID,
    name: "Acme",
    industry: "saas",
    plan_tier: "free",
    juror_weights: null,
    onboarded_at: "2026-09-18T00:00:00.000Z",
    created_at: "2026-08-31T00:00:00.000Z",
  };
}

function session(): SessionContext {
  return {
    authUserId: USER_ID,
    email: "member@acme.test",
    companyId: COMPANY_ID,
    role: "member" as UserRole,
    displayName: null,
    company: companyRow(),
  };
}

function userRow(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: USER_ID,
    company_id: COMPANY_ID,
    email: "member@acme.test",
    role: "member",
    display_name: null,
    notify_review_complete: true,
    notify_weekly_digest: false,
    notify_product_news: true,
    created_at: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

const ALL_ON: NotificationPreferences = {
  review_complete: true,
  weekly_digest: true,
  product_news: true,
};

describe("resolveNotificationPrefs", () => {
  it("applies the documented defaults when columns are absent", () => {
    expect(resolveNotificationPrefs({})).toEqual(DEFAULT_NOTIFICATION_PREFS);
    expect(DEFAULT_NOTIFICATION_PREFS).toEqual({
      review_complete: true,
      weekly_digest: false,
      product_news: true,
    });
  });

  it("reads explicit column values over the defaults", () => {
    expect(
      resolveNotificationPrefs({
        notify_review_complete: false,
        notify_weekly_digest: true,
        notify_product_news: false,
      }),
    ).toEqual({ review_complete: false, weekly_digest: true, product_news: false });
  });
});

describe("NotificationPrefsSchema", () => {
  it("accepts three booleans", () => {
    expect(NotificationPrefsSchema.safeParse(ALL_ON).success).toBe(true);
  });

  it("rejects a non-boolean field", () => {
    expect(
      NotificationPrefsSchema.safeParse({
        review_complete: "yes",
        weekly_digest: false,
        product_news: true,
      }).success,
    ).toBe(false);
  });
});

describe("notificationPrefsEqual", () => {
  it("is true for identical sets and false otherwise", () => {
    expect(notificationPrefsEqual(ALL_ON, { ...ALL_ON })).toBe(true);
    expect(
      notificationPrefsEqual(ALL_ON, { ...ALL_ON, weekly_digest: false }),
    ).toBe(false);
  });
});

describe("updateNotificationPreferences", () => {
  it("rejects an unauthenticated caller (401) without writing", async () => {
    const update = vi.fn();
    const result = await updateNotificationPreferences({
      session: null,
      input: ALL_ON,
      current: DEFAULT_NOTIFICATION_PREFS,
      update,
    });
    expect(result).toMatchObject({ ok: false, status: 401 });
    expect(update).not.toHaveBeenCalled();
  });

  it("rejects a malformed payload (400) without writing", async () => {
    const update = vi.fn();
    const result = await updateNotificationPreferences({
      session: session(),
      input: { review_complete: "nope", weekly_digest: 1, product_news: null },
      current: DEFAULT_NOTIFICATION_PREFS,
      update,
    });
    expect(result).toMatchObject({ ok: false, status: 400 });
    expect(update).not.toHaveBeenCalled();
  });

  it("saves changed prefs scoped to the session id + company id", async () => {
    const update = vi
      .fn()
      .mockResolvedValue(
        userRow({ notify_weekly_digest: true, notify_product_news: true }),
      );
    const result = await updateNotificationPreferences({
      session: session(),
      input: ALL_ON,
      current: DEFAULT_NOTIFICATION_PREFS, // weekly_digest off → changing it on
      update,
    });
    expect(result).toMatchObject({ ok: true, status: 200, changed: true });
    expect(update).toHaveBeenCalledWith({
      companyId: COMPANY_ID,
      userId: USER_ID,
      prefs: ALL_ON,
    });
  });

  it("is an idempotent no-op when nothing changed", async () => {
    const update = vi.fn();
    const result = await updateNotificationPreferences({
      session: session(),
      input: DEFAULT_NOTIFICATION_PREFS,
      current: DEFAULT_NOTIFICATION_PREFS,
      update,
    });
    expect(result).toMatchObject({ ok: true, status: 200, changed: false });
    expect(update).not.toHaveBeenCalled();
  });

  it("maps a write failure to a plain 500 (no internal detail leaked)", async () => {
    const update = vi.fn().mockRejectedValue(new Error("db down"));
    const result = await updateNotificationPreferences({
      session: session(),
      input: ALL_ON,
      current: DEFAULT_NOTIFICATION_PREFS,
      update,
    });
    expect(result).toMatchObject({ ok: false, status: 500 });
    if (!result.ok) expect(result.error).not.toContain("db down");
  });
});
