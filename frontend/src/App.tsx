import { Navigate, Route, Routes } from "react-router-dom";
import Nav from "./components/Nav";
import HomePage from "./pages/HomePage";
import DoomPage from "./pages/DoomPage";
import QuakePage from "./pages/QuakePage";
import CnCPage from "./pages/CnCPage";
import SourcePage from "./pages/SourcePage";
import FreeFirePage from "./pages/FreeFirePage";
import LockstepArenaPage from "./pages/LockstepArenaPage";
import AuthPage from "./pages/AuthPage";

export default function App() {
  return (
    <div className="app-shell">
      <aside>
        <h2>同步技术演进</h2>
        <Nav />
      </aside>
      <main>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/doom" element={<DoomPage />} />
          <Route path="/quake" element={<QuakePage />} />
          <Route path="/cnc" element={<CnCPage />} />
          <Route path="/source" element={<SourcePage />} />
          <Route path="/freefire" element={<FreeFirePage />} />
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/arena" element={<LockstepArenaPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
