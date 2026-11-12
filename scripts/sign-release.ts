// Signs a CI-built draft release on the developer's machine, where the minisign key lives, and
// uploads the signature beside the installer. Publishing stays a manual step.
// `bun run sign-release vX.Y.Z`; needs gh (logged in) and minisign on PATH.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installerName, parseReleaseVersion, type ReleaseVersion, trustedComment } from "../src/shared/release";
import { run, runInteractive, runSteps, step, StepFailed, versionInfo } from "./steps";

const REPO = join(import.meta.dirname, "..");
const PUBLIC_KEY = join(REPO, "minisign.pub");

export function versionFromTag(tag: string): ReleaseVersion {
  if (!tag.startsWith("v")) throw new StepFailed(`The tag "${tag}" isn't v<version>.`);
  try {
    return parseReleaseVersion(tag.slice(1));
  } catch (err) {
    throw new StepFailed(`The tag "${tag}" isn't v<version>: ${(err as Error).message}`, { cause: err });
  }
}

/** Why the release can't be signed, or null. */
export function draftIssue(view: { isDraft: boolean; assets: { name: string }[] }, asset: string): string | null {
  if (!view.isDraft) return "it's already published; sign a draft, before friends can download it";
  if (!view.assets.some((a) => a.name === asset)) return `the draft has no ${asset}; did the release workflow finish?`;
  return null;
}

/** The trusted comment from a .minisig, exactly as minisign wrote it. */
export function trustedCommentLine(minisig: string): string | null {
  const line = minisig.split(/\r?\n/).find((l) => l.startsWith("trusted comment: "));
  return line === undefined ? null : line.slice("trusted comment: ".length);
}

function main(): void {
  const tag = process.argv[2];
  if (!tag) throw new StepFailed("usage: bun run sign-release vX.Y.Z");
  const version = versionFromTag(tag);
  if (!existsSync(PUBLIC_KEY)) throw new StepFailed(`${PUBLIC_KEY} is missing; see docs/releasing.md for the one-time setup.`);
  const asset = installerName(version.full);

  step("Tag");
  // CI built whatever commit the tag names; only sign one that's on master, not a stray pushed tag.
  run(["git", "fetch", "--quiet", "origin", "master", `refs/tags/${tag}:refs/tags/${tag}`], { cwd: REPO });
  const commit = run(["git", "rev-parse", `${tag}^{commit}`], { cwd: REPO }).trim();
  try {
    run(["git", "merge-base", "--is-ancestor", commit, "origin/master"], { cwd: REPO });
  } catch (err) {
    if (!(err instanceof StepFailed)) throw err;
    throw new StepFailed(`${tag} is commit ${commit}, which isn't on origin/master; not signing it. ${err.message}`);
  }
  console.log(`${tag} is ${commit}, on origin/master.`);

  step("Draft");
  const view = JSON.parse(run(["gh", "release", "view", tag, "--json", "isDraft,assets"], { cwd: REPO })) as { isDraft: boolean; assets: { name: string }[] };
  const issue = draftIssue(view, asset);
  if (issue !== null) throw new StepFailed(`Can't sign ${tag}: ${issue}`);
  console.log(`${tag} is a draft holding ${asset}.`);

  const dir = mkdtempSync(join(tmpdir(), "grindlog-sign-"));
  try {
    step("Download");
    run(["gh", "release", "download", tag, "--pattern", asset, "--dir", dir], { cwd: REPO });
    const file = join(dir, asset);
    const productVersion = versionInfo(file, "ProductVersion");
    if (productVersion !== version.full) throw new StepFailed(`${asset} says it's version "${productVersion}", not ${version.full}; not signing it.`);
    console.log(`${file} is version ${productVersion}.`);

    step("Sign");
    runInteractive(["minisign", "-S", "-m", file, "-t", trustedComment(version.full)]);

    step("Verify");
    run(["minisign", "-V", "-p", PUBLIC_KEY, "-m", file]);
    const minisig = `${file}.minisig`;
    // Printed so the first release records what minisign appends; the updater accepts either form.
    console.log(`Verified against ${PUBLIC_KEY}. Trusted comment: ${JSON.stringify(trustedCommentLine(readFileSync(minisig, "utf8")))}`);

    step("Upload");
    // --clobber, so signing again (after a failed run, or a re-sign) replaces the draft's old signature.
    if (view.assets.some((a) => a.name === `${asset}.minisig`)) console.log(`Replacing the draft's existing ${asset}.minisig.`);
    run(["gh", "release", "upload", tag, minisig, "--clobber"], { cwd: REPO });
    console.log(`Uploaded ${asset}.minisig to ${tag}.`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  console.log(`\nAdd the release notes and publish the ${tag} draft by hand on GitHub.`);
}

if (import.meta.main) await runSteps("sign-release", main);
