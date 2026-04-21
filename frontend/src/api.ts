import type { Evolution } from "./types";

const API = String(import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");
const WS_BASE = String(import.meta.env.VITE_WS_BASE || "").replace(/\/+$/, "");
export const AUTH_TOKEN_STORAGE = "sync_auth_token";

function fallbackWsBase() {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}`;
}

export function lockstepWsUrl(token: string) {
  const base =
    WS_BASE ||
    (API
      ? API.startsWith("https://")
        ? API.replace(/^https:\/\//, "wss://")
        : API.startsWith("http://")
          ? API.replace(/^http:\/\//, "ws://")
          : fallbackWsBase()
      : fallbackWsBase());
  return `${base}/ws/lockstep?token=${encodeURIComponent(token)}`;
}

export async function fetchEvolutions(): Promise<Evolution[]> {
  const res = await fetch(`${API}/api/evolutions`);
  if (!res.ok) throw new Error("failed to fetch evolutions");
  const data = (await res.json()) as { items: Evolution[] };
  return data.items;
}

export async function authRegister(username: string, password: string) {
  const res = await fetch(`${API}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || data?.error || "register_failed");
  return data as { token: string; user: { id: string; username: string } };
}

export async function authLogin(username: string, password: string) {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username, password })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || data?.error || "login_failed");
  return data as { token: string; user: { id: string; username: string } };
}

export async function authMe(token: string) {
  const res = await fetch(`${API}/api/auth/me`, {
    headers: { authorization: `Bearer ${token}` }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || data?.error || "unauthorized");
  return data as { user: { id: string; username: string } };
}
