import crypto from "crypto";
import { pool } from "../db.mjs";

// ---------- password hashing (scrypt) ----------
export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored) return false;
  const [scheme, salt, hash] = String(stored).split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

// ---------- HMAC-signed tokens (mini-JWT, no extra deps) ----------
const SECRET = process.env.AUTH_SECRET || "classpulse-demo-secret-change-me";
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");

export function signToken(user, ttlSeconds = 60 * 60 * 12) {
  const payload = b64({
    uid: user.user_id ?? user.userId,
    role: user.role,
    name: user.full_name ?? user.fullName,
    email: user.email,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  });
  const sig = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== "string") return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!data.exp || data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch {
    return null;
  }
}

// ---------- express middleware ----------
export function requireAuth(...allowedRoles) {
  return (req, res, next) => {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    const data = verifyToken(token);
    if (!data) return res.status(401).json({ error: "Faculty sign-in required" });
    if (allowedRoles.length && !allowedRoles.includes(data.role)) {
      return res.status(403).json({ error: `Role '${data.role}' is not allowed to do this — faculty only` });
    }
    req.user = data;
    next();
  };
}

// Seeded demo users have no password until first boot sets one.
// Faculty demo credentials: meera.faculty@classpulse.local / faculty123
export async function ensureSeedPasswords() {
  const targets = [
    ["meera.faculty@classpulse.local", "faculty123"],
    ["aarav.mentor@classpulse.local", "mentor123"],
    ["kavya.counsellor@classpulse.local", "counsellor123"],
  ];
  for (const [email, password] of targets) {
    await pool.query(
      `UPDATE users SET password_hash = $2 WHERE email = $1 AND (password_hash IS NULL OR password_hash = '')`,
      [email, hashPassword(password)]
    );
  }
}

export async function findUserByLogin(email) {
  const { rows } = await pool.query(
    `SELECT user_id, full_name, email, role, password_hash, is_active
     FROM users WHERE lower(email) = lower($1)`,
    [String(email || "").trim()]
  );
  return rows[0] || null;
}
