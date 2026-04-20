import { useEffect, useState } from "react";
import { fetchEvolutions } from "../api";
import type { Evolution } from "../types";

export default function HomePage() {
  const [items, setItems] = useState<Evolution[]>([]);
  const [err, setErr] = useState<string>("");

  useEffect(() => {
    fetchEvolutions().then(setItems).catch((e: Error) => setErr(e.message));
  }, []);

  return (
    <section>
      <h1>多人同步技术演进可视化</h1>
      <p className="muted">从 DOOM 锁步到 Free Fire 混合同步。每个路由都带一个交互式小例子。</p>
      {err && <p className="error">后端读取失败：{err}</p>}
      <div className="timeline">
        {items.map((x) => (
          <article className="card" key={x.id}>
            <div className="era">{x.era}</div>
            <h3>{x.title}</h3>
            <p>{x.summary}</p>
            <div className="grid2">
              <div>
                <h4>优点</h4>
                <ul>
                  {x.strengths.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h4>风险</h4>
                <ul>
                  {x.weaknesses.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </div>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
