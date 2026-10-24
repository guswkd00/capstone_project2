const crypto = require("node:crypto");
const { promisify } = require("node:util");

const scrypt = promisify(crypto.scrypt);

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const key = await scrypt(password, salt, 64);

  return `${salt}:${key.toString("hex")}`;
}

async function verifyPassword(password, storedHash) {
  if (typeof storedHash !== "string") return false;

  const parts = storedHash.split(":");
  if (parts.length !== 2) return false;

  const [salt, savedKey] = parts;

  if (
    !/^[a-f0-9]{32}$/.test(salt) ||
    !/^[a-f0-9]{128}$/.test(savedKey)
  ) {
    return false;
  }

  const key = await scrypt(password, salt, 64);
  const expected = Buffer.from(savedKey, "hex");

  return crypto.timingSafeEqual(key, expected);
}

function createToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

module.exports = {
  hashPassword,
  verifyPassword,
  createToken,
  hashToken,
};