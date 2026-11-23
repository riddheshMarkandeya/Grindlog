import { describe, expect, test } from "vitest";
import type { IdRow } from "../../shared/schemas/responses";
import { accountPicker } from "./accounts";

const row = (primaryId: string, name: string | null, platform: string, status: IdRow["status"]): IdRow => ({ primaryId, name, platform, status });
const MAIN = row("Epic|main|0", "Mainly", "Epic", "confirmed");
const ALT = row("Steam|alt|0", "Alty", "Steam", "confirmed");

describe("accountPicker", () => {
  test("all accounts first, then each confirmed id as name · platform in added order; pending and rejected ids aren't listed", () => {
    const ids = [MAIN, row("PS4|guess|0", "Guess", "PlayStation", "pending"), ALT, row("XboxOne|no|0", "No", "Xbox", "rejected")];
    expect(accountPicker(ids, "all")).toEqual({
      options: [
        { value: "all", label: "All accounts" },
        { value: MAIN.primaryId, label: "Mainly · Epic" },
        { value: ALT.primaryId, label: "Alty · Steam" },
      ],
      value: "all",
    });
  });

  test("an id with no name is its platform alone", () => {
    expect(accountPicker([MAIN, { ...ALT, name: null }], "all")?.options[2]).toEqual({ value: ALT.primaryId, label: "Steam" });
  });

  test("the saved id is the value; one that can't be used shows as all accounts", () => {
    expect(accountPicker([MAIN, ALT], ALT.primaryId)?.value).toBe(ALT.primaryId);
    expect(accountPicker([MAIN, { ...ALT, status: "pending" }, row("Switch|s|0", "S", "Switch", "confirmed")], ALT.primaryId)?.value).toBe("all");
  });

  test("no picker with fewer than 2 confirmed ids", () => {
    expect(accountPicker([], "all")).toBeNull();
    expect(accountPicker([MAIN, { ...ALT, status: "pending" }], "all")).toBeNull();
  });
});
