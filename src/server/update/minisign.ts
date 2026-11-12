// Verifies a minisign signature with node:crypto alone. Format (minisign's README and src/minisign.c):
// a public key is base64 of "Ed" + 8-byte key id + 32-byte Ed25519 key; a .minisig is four lines:
// an untrusted comment, base64 of algorithm ("ED" prehashed with BLAKE2b-512, "Ed" legacy) + key id
// + 64-byte signature, the trusted comment, and base64 of a 64-byte signature over
// signature ‖ trusted comment, which is what makes the comment trustworthy.
import { createHash, createPublicKey, verify, type KeyObject } from "node:crypto";

export type VerifyFailure = "malformed" | "unknown_algorithm" | "key_mismatch" | "bad_signature" | "bad_comment_signature";
export type VerifyResult = { ok: true; trustedComment: string } | { ok: false; reason: VerifyFailure };

const UNTRUSTED = "untrusted comment:";
const TRUSTED = "trusted comment: ";
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Decodes strict base64 of exactly `length` bytes, or null. */
function bytes(line: string, length: number): Buffer | null {
  if (!BASE64.test(line)) return null;
  const b = Buffer.from(line, "base64");
  return b.length === length ? b : null;
}

interface PublicKey {
  keyId: Buffer;
  key: KeyObject;
}

function parsePublicKey(line: string): PublicKey | null {
  const b = bytes(line, 42);
  if (b?.subarray(0, 2).toString("latin1") !== "Ed") return null;
  const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: b.subarray(10).toString("base64url") }, format: "jwk" });
  return { keyId: b.subarray(2, 10), key };
}

/** The base64 key line of a minisign.pub file's text, or null if it isn't one. */
export function publicKeyLine(text: string): string | null {
  const [comment, line] = text.split(/\r?\n/);
  if (comment?.startsWith(UNTRUSTED) !== true || line === undefined) return null;
  return bytes(line, 42)?.subarray(0, 2).toString("latin1") === "Ed" ? line : null;
}

export function verifyMinisign({ publicKey, signature, file }: { publicKey: string; signature: string; file: Uint8Array }): VerifyResult {
  const pk = parsePublicKey(publicKey);
  const lines = signature.replace(/\r?\n$/, "").split(/\r?\n/);
  if (pk === null || lines.length !== 4) return { ok: false, reason: "malformed" };
  const [untrusted = "", sigLine = "", trustedLine = "", globalLine = ""] = lines;
  const sig = bytes(sigLine, 74);
  const globalSig = bytes(globalLine, 64);
  if (!untrusted.startsWith(UNTRUSTED) || !trustedLine.startsWith(TRUSTED) || sig === null || globalSig === null) return { ok: false, reason: "malformed" };

  const algorithm = sig.subarray(0, 2).toString("latin1");
  if (algorithm !== "ED" && algorithm !== "Ed") return { ok: false, reason: "unknown_algorithm" };
  if (!sig.subarray(2, 10).equals(pk.keyId)) return { ok: false, reason: "key_mismatch" };

  const signed = sig.subarray(10);
  const message = algorithm === "ED" ? createHash("blake2b512").update(file).digest() : file;
  if (!verify(null, message, pk.key, signed)) return { ok: false, reason: "bad_signature" };

  const comment = trustedLine.slice(TRUSTED.length);
  if (!verify(null, Buffer.concat([signed, Buffer.from(comment, "utf8")]), pk.key, globalSig)) return { ok: false, reason: "bad_comment_signature" };
  return { ok: true, trustedComment: comment };
}
