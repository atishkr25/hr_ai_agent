import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Minimal HS256 JSON Web Token implementation (RFC 7519) on Node's crypto.
 * Signing and verification are synchronous so role checks stay simple in
 * every route handler.
 */

export type JwtClaims = Record<string, unknown> & {
  sub: string;
  iat: number;
  exp: number;
};

const HEADER = { alg: "HS256", typ: "JWT" } as const;

function jwtSecret(): string | null {
  const secret = process.env.AUTH_SESSION_SECRET?.trim();
  if (secret) {
    return secret;
  }

  return process.env.NODE_ENV === "production" ? null : "dev-only-unsafe-secret";
}

function encodeSegment(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeSegment<T>(segment: string): T | null {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
}

function signature(input: string, secret: string): string {
  return createHmac("sha256", secret).update(input).digest("base64url");
}

export function signJwt(
  claims: Record<string, unknown> & { sub: string },
  expiresInSeconds: number,
): string {
  const secret = jwtSecret();
  if (!secret) {
    throw new Error("AUTH_SESSION_SECRET must be set to issue sessions in production.");
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: JwtClaims = { ...claims, iat: issuedAt, exp: issuedAt + expiresInSeconds };
  const unsigned = `${encodeSegment(HEADER)}.${encodeSegment(payload)}`;
  return `${unsigned}.${signature(unsigned, secret)}`;
}

export function verifyJwt<T extends Record<string, unknown>>(
  token: string | undefined | null,
): (T & JwtClaims) | null {
  const secret = jwtSecret();
  if (!token || !secret) {
    return null;
  }

  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }

  const [encodedHeader, encodedPayload, providedSignature] = parts;
  const header = decodeSegment<{ alg?: string; typ?: string }>(encodedHeader);
  // Pin the algorithm so a token cannot downgrade to "none" or another alg.
  if (header?.alg !== HEADER.alg) {
    return null;
  }

  const expected = Buffer.from(signature(`${encodedHeader}.${encodedPayload}`, secret), "utf8");
  const provided = Buffer.from(providedSignature, "utf8");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return null;
  }

  const payload = decodeSegment<T & JwtClaims>(encodedPayload);
  if (!payload || typeof payload.sub !== "string" || typeof payload.exp !== "number") {
    return null;
  }

  if (payload.exp <= Math.floor(Date.now() / 1000)) {
    return null;
  }

  return payload;
}
