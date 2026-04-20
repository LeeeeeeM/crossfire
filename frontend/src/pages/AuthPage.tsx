import { FormEvent, useState } from "react";
import { authLogin, authRegister, AUTH_TOKEN_STORAGE } from "../api";

type Mode = "login" | "register";

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setMsg("");
    setErr("");

    try {
      const api = mode === "login" ? authLogin : authRegister;
      const ret = await api(username.trim().toLowerCase(), password);
      localStorage.setItem(AUTH_TOKEN_STORAGE, ret.token);
      setMsg(`成功，已登录为 ${ret.user.username}。现在可以去 WS Arena。`);
      setPassword("");
    } catch (error: any) {
      setErr(String(error?.message || "请求失败"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section>
      <h1>账号系统（PostgreSQL）</h1>
      <p className="muted">注册后自动登录。Arena 会用账号身份作为玩家 ID，刷新和多 tab 都稳定。</p>

      <div className="card auth-card">
        <div className="auth-tabs">
          <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")} type="button">登录</button>
          <button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")} type="button">注册</button>
        </div>

        <form onSubmit={onSubmit} className="auth-form">
          <label>
            用户名
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="3-24 位字母/数字/下划线"
              autoComplete="username"
              required
            />
          </label>

          <label>
            密码
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="至少 6 位"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              required
            />
          </label>

          <button type="submit" disabled={submitting}>
            {submitting ? "提交中..." : mode === "login" ? "登录" : "注册并登录"}
          </button>
        </form>

        {msg && <p className="ok">{msg}</p>}
        {err && <p className="error">{err}</p>}
      </div>
    </section>
  );
}
