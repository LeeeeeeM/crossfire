import { randomBytes } from "node:crypto";
import { pool } from "./db";

export type AuthUser = {
  id: string;
  username: string;
};

const SESSION_TTL_DAYS = 30;

export function validateUsername(username: string) {
  return /^[a-zA-Z0-9_]{3,24}$/.test(username);
}

export function validatePassword(password: string) {
  return password.length >= 6 && password.length <= 128;
}

async function createSession(userId: string) {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO sessions(token, user_id, expires_at) VALUES($1, $2, $3)`,
    [token, userId, expiresAt]
  );
  return token;
}

export async function registerUser(username: string, password: string) {
  const normalized = username.trim().toLowerCase();
  const hashed = await Bun.password.hash(password);

  const inserted = await pool.query<{ id: string; username: string }>(
    `INSERT INTO users(username, password_hash) VALUES($1, $2)
     ON CONFLICT(username) DO NOTHING
     RETURNING id::text, username`,
    [normalized, hashed]
  );

  if (inserted.rowCount === 0) return null;

  const user = inserted.rows[0];
  const token = await createSession(user.id);
  return { user, token };
}

export async function loginUser(username: string, password: string) {
  const normalized = username.trim().toLowerCase();

  const found = await pool.query<{ id: string; username: string; password_hash: string }>(
    `SELECT id::text, username, password_hash FROM users WHERE username = $1`,
    [normalized]
  );

  if (found.rowCount === 0) return null;

  const row = found.rows[0];
  const ok = await Bun.password.verify(password, row.password_hash);
  if (!ok) return null;

  const token = await createSession(row.id);
  return {
    user: { id: row.id, username: row.username },
    token
  };
}

export async function getUserByToken(token: string): Promise<AuthUser | null> {
  if (!token) return null;

  const q = await pool.query<{ id: string; username: string }>(
    `SELECT u.id::text, u.username
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = $1 AND s.expires_at > NOW()`,
    [token]
  );

  if (q.rowCount === 0) return null;
  return q.rows[0];
}

export async function revokeSession(token: string) {
  if (!token) return;
  await pool.query(`DELETE FROM sessions WHERE token = $1`, [token]);
}
