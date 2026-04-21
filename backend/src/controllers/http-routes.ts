import { getUserByToken, loginUser, registerUser, revokeSession, validatePassword, validateUsername } from "../services/auth-service";
import { evolutions } from "../data/game-data";
import { bearerToken, readBody } from "../utils/http";
import { VALIDATION_CONFIG } from "../config/validation-config";

type HandleHttpApiRoutesParams = {
  req: Request;
  url: URL;
  json: (data: unknown, init?: ResponseInit) => Response;
  dbReady: boolean;
  requireDb: () => Response | null;
};

export async function handleHttpApiRoutes(params: HandleHttpApiRoutesParams): Promise<Response | null> {
  const { req, url, json, dbReady, requireDb } = params;

  if (req.method === "OPTIONS") {
    return json({ ok: true });
  }

  if (url.pathname === "/health") {
    return json({ status: "ok", runtime: "bun", dbReady });
  }

  if (url.pathname === "/api/auth/register" && req.method === "POST") {
    const dbErr = requireDb();
    if (dbErr) return dbErr;

    const body = await readBody(req);
    const username = String(body?.username || "").trim().toLowerCase();
    const password = String(body?.password || "");

    if (!validateUsername(username)) {
      return json(
        {
          error: "invalid_username",
          message: `用户名需为 ${VALIDATION_CONFIG.usernameMinLen}-${VALIDATION_CONFIG.usernameMaxLen} 位字母/数字/下划线`
        },
        { status: 400 }
      );
    }
    if (!validatePassword(password)) {
      return json(
        {
          error: "invalid_password",
          message: `密码长度需为 ${VALIDATION_CONFIG.passwordMinLen}-${VALIDATION_CONFIG.passwordMaxLen}`
        },
        { status: 400 }
      );
    }

    const ret = await registerUser(username, password);
    if (!ret) {
      return json({ error: "username_exists", message: "用户名已存在" }, { status: 409 });
    }

    return json({ token: ret.token, user: ret.user }, { status: 201 });
  }

  if (url.pathname === "/api/auth/login" && req.method === "POST") {
    const dbErr = requireDb();
    if (dbErr) return dbErr;

    const body = await readBody(req);
    const username = String(body?.username || "").trim().toLowerCase();
    const password = String(body?.password || "");

    const ret = await loginUser(username, password);
    if (!ret) {
      return json({ error: "invalid_credentials", message: "用户名或密码错误" }, { status: 401 });
    }

    return json({ token: ret.token, user: ret.user });
  }

  if (url.pathname === "/api/auth/me" && req.method === "GET") {
    const dbErr = requireDb();
    if (dbErr) return dbErr;

    const token = bearerToken(req, url);
    if (!token) return json({ error: "unauthorized" }, { status: 401 });

    const user = await getUserByToken(token);
    if (!user) return json({ error: "unauthorized" }, { status: 401 });
    return json({ user });
  }

  if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    const dbErr = requireDb();
    if (dbErr) return dbErr;

    const token = bearerToken(req, url);
    if (token) await revokeSession(token);
    return json({ ok: true });
  }

  if (url.pathname === "/api/evolutions") {
    return json({ items: evolutions });
  }

  if (url.pathname.startsWith("/api/evolutions/")) {
    const id = url.pathname.split("/").pop();
    const item = evolutions.find((x) => x.id === id);
    if (!item) return json({ error: "not_found" }, { status: 404 });
    return json(item);
  }

  return null;
}
