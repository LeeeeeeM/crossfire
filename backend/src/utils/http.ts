export function jsonResponse(corsOrigin: string) {
  return (data: unknown, init?: ResponseInit) =>
    new Response(JSON.stringify(data), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": corsOrigin,
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type,authorization"
      },
      ...init
    });
}

export async function readBody(req: Request): Promise<any> {
  try {
    return (await req.json()) as any;
  } catch {
    return null;
  }
}

export function bearerToken(req: Request, url: URL) {
  const auth = req.headers.get("authorization") || "";
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m) return m[1].trim();
  const qsToken = (url.searchParams.get("token") || "").trim();
  return qsToken || "";
}
