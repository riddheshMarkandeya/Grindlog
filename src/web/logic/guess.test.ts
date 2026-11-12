import { describe, expect, test } from "vitest";
import type { IdRow } from "../../shared/schemas/responses";
import { pickGuess } from "./guess";

const row = (primaryId: string, status: IdRow["status"]): IdRow => ({ primaryId, name: primaryId, platform: "Steam", status });

describe("pickGuess", () => {
  test("the first unanswered guess not dismissed", () => {
    const rows = [row("me", "confirmed"), row("a", "pending"), row("b", "pending")];
    expect(pickGuess(rows, [])?.primaryId).toBe("a");
    expect(pickGuess(rows, ["a"])?.primaryId).toBe("b");
  });

  test("none when every guess is answered or dismissed", () => {
    expect(pickGuess([row("me", "confirmed"), row("x", "rejected")], [])).toBeNull();
    expect(pickGuess([row("a", "pending")], ["a"])).toBeNull();
    expect(pickGuess(undefined, [])).toBeNull();
  });

  test("a new alt is asked even after an older guess was dismissed", () => {
    expect(pickGuess([row("a", "pending"), row("new", "pending")], ["a"])?.primaryId).toBe("new");
  });
});
