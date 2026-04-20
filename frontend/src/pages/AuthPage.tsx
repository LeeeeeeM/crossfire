import { FormEvent, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { authLogin, authRegister, AUTH_TOKEN_STORAGE } from "../api";

type Mode = "login" | "register";

export default function AuthPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const existingToken = localStorage.getItem(AUTH_TOKEN_STORAGE) || "";
  if (existingToken) return <Navigate to="/lobby" replace />;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setMsg("");
    setErr("");

    try {
      const api = mode === "login" ? authLogin : authRegister;
      const ret = await api(username.trim().toLowerCase(), password);
      localStorage.setItem(AUTH_TOKEN_STORAGE, ret.token);
      setMsg(`成功，已登录为 ${ret.user.username}。正在进入游戏大厅...`);
      setPassword("");
      setTimeout(() => navigate("/lobby", { replace: true }), 200);
    } catch (error: any) {
      setErr(String(error?.message || "请求失败"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="shooter-page">
      <div className="page-hero">
        <h1>WS Arena</h1>
        <p className="muted">锁步对战 · 低延迟输入 · 即刻开火。</p>
      </div>

      <div className="auth-layout">
        <div className="auth-hero">
          <h2>进入战场</h2>
          <p className="muted">WASD 移动，鼠标瞄准/射击。加入房间后由房主开局。</p>
          <ul className="auth-bullets">
            <li>手感优先：客户端预测 + 回滚修正</li>
            <li>身份稳定：账号即玩家 ID（刷新/多标签一致）</li>
            <li>战术面板：帧、队列、延迟、FPS 一眼看懂</li>
          </ul>
        </div>

        <div className="card auth-card" aria-live="polite">
          <div className="auth-tabs" role="tablist" aria-label="登录方式">
            <button
              className={mode === "login" ? "active" : ""}
              onClick={() => setMode("login")}
              type="button"
              role="tab"
              aria-selected={mode === "login"}
            >
              登录
            </button>
            <button
              className={mode === "register" ? "active" : ""}
              onClick={() => setMode("register")}
              type="button"
              role="tab"
              aria-selected={mode === "register"}
            >
              注册
            </button>
          </div>

          <form onSubmit={onSubmit} className="auth-form">
            <label>
              用户名
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="3-24 位字母/数字/下划线"
                autoComplete="username"
                inputMode="text"
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

            <button type="submit" disabled={submitting} className="btn-secondary">
              {submitting ? "正在校验..." : mode === "login" ? "进入大厅" : "创建身份并进入"}
            </button>
          </form>

          {msg && <p className="ok">{msg}</p>}
          {err && <p className="error">{err}</p>}
        </div>
      </div>
    </section>
  );
}
