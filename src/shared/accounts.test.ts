import { describe, expect, test } from "vitest";
import { resolveAccount } from "./accounts";

const A = "Epic|a|0";
const B = "Steam|b|0";
const C = "PS4|c|0";
const id = (primaryId: string, status: string) => ({ primaryId, status });

describe("resolveAccount", () => {
  test("a confirmed id with another confirmed id beside it is the account", () => {
    expect(resolveAccount([id(A, "confirmed"), id(B, "confirmed")], B)).toEqual({ account: B, fallback: null });
  });

  test("all is every account, and no fallback", () => {
    expect(resolveAccount([id(A, "confirmed"), id(B, "confirmed")], "all")).toEqual({ account: null, fallback: null });
    expect(resolveAccount([], "all")).toEqual({ account: null, fallback: null });
  });

  test("a pending, rejected or removed id falls back to all", () => {
    const ids = [id(A, "confirmed"), id(B, "confirmed"), id(C, "pending"), id("XboxOne|x|0", "rejected")];
    expect(resolveAccount(ids, C)).toEqual({ account: null, fallback: "not_confirmed" });
    expect(resolveAccount(ids, "XboxOne|x|0")).toEqual({ account: null, fallback: "not_confirmed" });
    expect(resolveAccount(ids, "Switch|gone|0")).toEqual({ account: null, fallback: "not_confirmed" });
  });

  test("fewer than 2 confirmed ids falls back to all, even for the confirmed one; pending ids don't make up the count", () => {
    expect(resolveAccount([id(A, "confirmed"), id(B, "pending")], A)).toEqual({ account: null, fallback: "too_few" });
    expect(resolveAccount([id(A, "confirmed"), id(B, "rejected")], A)).toEqual({ account: null, fallback: "too_few" });
  });
});
