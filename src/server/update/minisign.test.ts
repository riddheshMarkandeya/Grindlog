import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { publicKeyLine, verifyMinisign } from "./minisign";

const fixture = (name: string) => readFileSync(join(import.meta.dirname, "fixtures", name));
const text = (name: string) => fixture(name).toString("utf8");

// minisign's own 0.12 release asset and signature, as published, with the key from its README.
const UPSTREAM = { publicKey: publicKeyLine(text("jedisct1.pub")) ?? "", signature: text("minisign-0.12-wasm.gz.minisig"), file: fixture("minisign-0.12-wasm.gz") };

/** `signature` with line `index` (0-based) replaced. */
const withLine = (signature: string, index: number, line: string) => signature.split("\n").map((l, i) => (i === index ? line : l)).join("\n");
/** Flips one bit of a base64 line's decoded byte at `at`. */
const flipB64 = (line: string, at: number) => {
  const b = Buffer.from(line, "base64");
  b[at] = (b[at] ?? 0) ^ 1;
  return b.toString("base64");
};
const lines = UPSTREAM.signature.split("\n");
const SIG_LINE = lines[1] ?? "";
const GLOBAL_LINE = lines[3] ?? "";

describe("verifyMinisign on minisign's own release signature (prehashed)", () => {
  test("accepts it and returns the trusted comment, tab and hashed suffix included", () => {
    expect(verifyMinisign(UPSTREAM)).toEqual({ ok: true, trustedComment: "timestamp:1737031438\tfile:minisign-0.12-wasm.gz\thashed" });
  });

  test("accepts CRLF line endings", () => {
    expect(verifyMinisign({ ...UPSTREAM, signature: UPSTREAM.signature.replaceAll("\n", "\r\n") }).ok).toBe(true);
  });

  test("a changed byte in the file is a bad signature", () => {
    const file = Buffer.from(UPSTREAM.file);
    file[1000] = (file[1000] ?? 0) ^ 1;
    expect(verifyMinisign({ ...UPSTREAM, file })).toEqual({ ok: false, reason: "bad_signature" });
  });

  test("a changed trusted comment fails the global signature", () => {
    const signature = withLine(UPSTREAM.signature, 2, "trusted comment: version=9.9.9 file=Grindlog-Setup-9.9.9.exe");
    expect(verifyMinisign({ ...UPSTREAM, signature })).toEqual({ ok: false, reason: "bad_comment_signature" });
  });

  test("a changed global signature fails", () => {
    expect(verifyMinisign({ ...UPSTREAM, signature: withLine(UPSTREAM.signature, 3, flipB64(GLOBAL_LINE, 5)) })).toEqual({ ok: false, reason: "bad_comment_signature" });
  });

  test("a changed file signature fails", () => {
    expect(verifyMinisign({ ...UPSTREAM, signature: withLine(UPSTREAM.signature, 1, flipB64(SIG_LINE, 20)) })).toEqual({ ok: false, reason: "bad_signature" });
  });

  test("a different key id is a key mismatch", () => {
    expect(verifyMinisign({ ...UPSTREAM, signature: withLine(UPSTREAM.signature, 1, flipB64(SIG_LINE, 3)) })).toEqual({ ok: false, reason: "key_mismatch" });
  });

  test("an algorithm other than Ed or ED is unknown", () => {
    const b = Buffer.from(SIG_LINE, "base64");
    b.write("EX", 0, "latin1");
    expect(verifyMinisign({ ...UPSTREAM, signature: withLine(UPSTREAM.signature, 1, b.toString("base64")) })).toEqual({ ok: false, reason: "unknown_algorithm" });
  });

  test.each([
    ["an empty signature", ""],
    ["an HTML page", "<!DOCTYPE html><html></html>"],
    ["three lines", lines.slice(0, 3).join("\n")],
    ["no untrusted comment prefix", withLine(UPSTREAM.signature, 0, "comment: x")],
    ["no trusted comment prefix", withLine(UPSTREAM.signature, 2, "timestamp:1")],
    ["a short signature line", withLine(UPSTREAM.signature, 1, SIG_LINE.slice(0, 40))],
    ["a short global signature", withLine(UPSTREAM.signature, 3, GLOBAL_LINE.slice(0, 40))],
    ["a signature line that isn't base64", withLine(UPSTREAM.signature, 1, "!".repeat(SIG_LINE.length))],
  ])("%s is malformed", (_, signature) => {
    expect(verifyMinisign({ ...UPSTREAM, signature })).toEqual({ ok: false, reason: "malformed" });
  });

  test.each([
    ["empty", ""],
    ["too short", UPSTREAM.publicKey.slice(0, 20)],
    ["not Ed", Buffer.concat([Buffer.from("XX"), Buffer.from(UPSTREAM.publicKey, "base64").subarray(2)]).toString("base64")],
  ])("a public key that's %s is malformed", (_, publicKey) => {
    expect(verifyMinisign({ ...UPSTREAM, publicKey })).toEqual({ ok: false, reason: "malformed" });
  });
});

describe("publicKeyLine", () => {
  test("reads the key line of a minisign.pub", () => {
    expect(publicKeyLine(text("jedisct1.pub"))).toBe("RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3");
  });

  test.each(["", "untrusted comment: x\n", "untrusted comment: x\nnot-a-key\n", "RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3\n"])("is null for %j", (s) => {
    expect(publicKeyLine(s)).toBeNull();
  });
});

// Made with the minisign 0.12 CLI and a throwaway passwordless key: the release contract comment as `-t` gives it (no suffix), the same comment with a literal
// tab + "hashed", and a legacy (-l) signature. The Windows CLI writes CRLF line endings.
describe("verifyMinisign on CLI-made signatures", () => {
  const key = publicKeyLine(text("test.pub")) ?? "";
  const payload = fixture("payload.bin");
  const CONTRACT = "version=9.9.9 file=Grindlog-Setup-9.9.9.exe";

  test.each([
    ["prehashed, -t comment as given", "payload.prehashed.minisig", CONTRACT],
    ["prehashed, comment with the hashed suffix", "payload.hashed-suffix.minisig", `${CONTRACT}\thashed`],
    ["legacy", "payload.legacy.minisig", CONTRACT],
  ])("accepts a %s signature", (_, sig, comment) => {
    expect(verifyMinisign({ publicKey: key, signature: text(sig), file: payload })).toEqual({ ok: true, trustedComment: comment });
  });

  test("a legacy signature over a changed file fails", () => {
    const file = Buffer.from(payload);
    file[0] = (file[0] ?? 0) ^ 1;
    expect(verifyMinisign({ publicKey: key, signature: text("payload.legacy.minisig"), file })).toEqual({ ok: false, reason: "bad_signature" });
  });

  test("another key's public key is a key mismatch", () => {
    expect(verifyMinisign({ publicKey: publicKeyLine(text("other.pub")) ?? "", signature: text("payload.prehashed.minisig"), file: payload })).toEqual({ ok: false, reason: "key_mismatch" });
  });
});
