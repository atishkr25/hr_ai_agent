import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// Stored format: scrypt$<N>$<r>$<p>$<salt>$<hash>, so parameters can be raised
// later without invalidating existing passwords.
const COST = 16384;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_LENGTH = 64;

function deriveKey(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, options, (error, key) => {
      if (error) {
        reject(error);
      } else {
        resolve(key);
      }
    });
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await deriveKey(password, salt, { N: COST, r: BLOCK_SIZE, p: PARALLELISM });
  return ["scrypt", COST, BLOCK_SIZE, PARALLELISM, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, cost, blockSize, parallelism, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) {
    return false;
  }

  const expected = Buffer.from(hash, "base64");
  const actual = await deriveKey(password, Buffer.from(salt, "base64"), {
    N: Number(cost),
    r: Number(blockSize),
    p: Number(parallelism),
  });
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
