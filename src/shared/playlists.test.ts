import { describe, expect, test } from "vitest";
import { PLAYLISTS, TIMELINE_PLAYLISTS, playlistInfo } from "./playlists";

describe("playlistInfo", () => {
  test("known ids", () => {
    expect(playlistInfo(13)).toEqual({ name: "Ranked Standard", group: "ranked", ranked: true });
    expect(playlistInfo(2)).toEqual({ name: "Doubles", group: "casual", ranked: false });
    expect(playlistInfo(6)).toEqual({ name: "Private Match", group: "private", ranked: false });
    expect(playlistInfo(27)).toEqual({ name: "Ranked Hoops", group: "ranked", ranked: true });
    expect(playlistInfo(38)).toMatchObject({ group: "ltm", ranked: false });
  });

  test("4 is Casual Quads, not Chaos: the id was reused (seen live)", () => {
    expect(playlistInfo(4)).toEqual({ name: "Casual Quads", group: "casual", ranked: false });
  });

  test("53 is Honor Duel: a 1v1 seen live, named by the user", () => {
    expect(playlistInfo(53)).toEqual({ name: "Honor Duel", group: "extra", ranked: false });
  });

  test("63 is Ranked Heatseeker: a 2v2 seen live, named by the user", () => {
    expect(playlistInfo(63)).toEqual({ name: "Ranked Heatseeker", group: "ranked", ranked: true });
  });

  test("an unknown id, or none, names itself and has no group or ranked flag", () => {
    expect(playlistInfo(999)).toEqual({ name: "Unknown playlist (999)", group: null, ranked: null });
    expect(playlistInfo(null)).toEqual({ name: "Unknown playlist", group: null, ranked: null });
  });

  test("menu states are not playlists", () => {
    expect(playlistInfo(0).group).toBeNull();
    expect(playlistInfo(-2).group).toBeNull();
  });
});

describe("TIMELINE_PLAYLISTS", () => {
  test("the standard soccar playlists and Honor Duel, each a known playlist", () => {
    expect([...TIMELINE_PLAYLISTS].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 10, 11, 12, 13, 34, 53]);
    for (const id of TIMELINE_PLAYLISTS) expect(PLAYLISTS[id]).toBeDefined();
  });
});
