// The landing page's screenshots (`bun run site:screens`), from the pseudonymised real data that
// `bun run screens-data` wrote (the `screens` seed), on a prod-look build of the dashboard. Writes
// site/screens/*.png and site/og.png. Look over every PNG before committing: no real names, ids or
// Windows paths.
//
// Which session and friends to show is picked from the data, not hard-coded, because the fake ids
// shift with the --since/--max-matches window: the session with the most wins (or
// GRINDLOG_SCREENS_SESSION, a session key), the friend you've played the most with, and the pair
// you've played the most with.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Page } from "@playwright/test";
import type { z } from "zod";
import { REQUEST_HEADER } from "../../src/shared/constants";
import type { friendsResponse, SessionDetail, SessionList } from "../../src/shared/schemas/responses";
import { expect, test } from "../e2e/fixtures";
import { DESKTOP, shoot, SITE } from "./shoot";

// A phone's width: the dashboard's own narrow layout is the tight crop the page shows on phones.
const PHONE = { width: 390, height: 700 };

const id = (s: string) => encodeURIComponent(s);
const most = <T>(rows: readonly T[], score: (r: T) => number): T => {
  const best = rows.reduce<T | undefined>((a, r) => (a === undefined || score(r) > score(a) ? r : a), undefined);
  if (best === undefined) throw new Error("the screens data has none of these; widen the screens-data window");
  return best;
};

async function json<T>(page: Page, path: string): Promise<T> {
  const res = await page.request.get(path);
  expect(res.ok(), path).toBe(true);
  return (await res.json()) as T;
}

test.use({ seed: "screens", viewport: DESKTOP, deviceScaleFactor: 2 });

test("writes the tour, spotlight and gallery screens", async ({ page, request }) => {
  test.setTimeout(180_000);
  expect((await request.post("/api/settings?theme=carbon", { headers: { [REQUEST_HEADER]: "1" } })).ok()).toBe(true);

  const { sessions } = await json<SessionList>(page, "/api/sessions?from=1000-01-01&to=9999-12-31");
  const key = process.env.GRINDLOG_SCREENS_SESSION ?? most(sessions, (s) => s.wins).key;
  const { matches } = await json<SessionDetail>(page, `/api/sessions/${key}`);
  const won = matches.filter((m) => m.result === "win");
  const match = most(won, (m) => (m.me?.goals ?? 0) * 2 + (m.me?.assists ?? 0));
  const { friends, pairs } = await json<z.infer<typeof friendsResponse>>(page, "/api/friends");
  const friend = most(friends, (f) => f.with.n + f.against.n);
  const pair = most(pairs, (p) => p.with.n);

  const recap = `/recap/${key}`;
  const friendPage = `/friends/${id(friend.id)}`;
  await page.goto(recap);
  await expect(page.getByText("Best win streak", { exact: false })).toBeVisible();
  await shoot(page, "recap");
  await shoot(page, "recap-goals", { scrollTo: "Where the goals came from" });

  await page.goto(`${recap}/match/${match.guid}`);
  await expect(page.getByRole("heading", { name: "Where the goals came from" })).toBeVisible();
  await shoot(page, "match");

  await page.goto("/trends");
  await page.getByRole("button", { name: "All time", exact: true }).click();
  await shoot(page, "trends");

  await page.goto(recap);
  await page.getByRole("button", { name: "Share" }).click();
  const card = page.locator("dialog").first();
  await expect(card).toBeVisible();
  await shoot(page, "share", { target: card });
  await page.keyboard.press("Escape");

  await page.goto("/friends");
  await expect(page.getByRole("heading", { name: "Your friends" })).toBeVisible();
  await shoot(page, "friends");

  await page.goto(friendPage);
  await expect(page.getByRole("heading", { name: "Match by match" })).toBeVisible();
  await shoot(page, "friend");
  await shoot(page, "friend-matches", { scrollTo: "Match by match" });

  await page.goto(`/friends/${id(pair.ids[0])}/${id(pair.ids[1])}`);
  await expect(page.getByRole("heading", { name: "Both on your team" })).toBeVisible();
  await shoot(page, "pair");

  // The phone crops, for the hero and the spotlight's big screen.
  await page.setViewportSize(PHONE);
  await page.goto(recap);
  await expect(page.getByText("Best win streak", { exact: false })).toBeVisible();
  await shoot(page, "recap-m");
  await page.goto(friendPage);
  await expect(page.getByRole("heading", { name: "Match by match" })).toBeVisible();
  await shoot(page, "friend-m");
});

// Open Graph wants exactly 1200x630, so this one is 1x.
test.describe("social card", () => {
  test.use({ deviceScaleFactor: 1 });

  test("writes the social card from the recap screen", async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 630 });
    await page.goto(pathToFileURL(join(import.meta.dirname, "og.html")).href);
    await page.evaluate("document.fonts.ready.then(() => true)");
    // naturalWidth, not complete: a missing recap.png is "complete" too, as a broken image.
    await expect.poll(() => page.evaluate("document.querySelector('img').naturalWidth")).toBeGreaterThan(0);
    await page.screenshot({ path: join(SITE, "og.png") });
  });
});
