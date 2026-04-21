import { Navigate, Route, Routes } from "react-router-dom";
import LockstepArenaPage from "./pages/LockstepArenaPage";
import AuthPage from "./pages/AuthPage";
import { SystemAnnouncerProvider } from "./components/SystemAnnouncer";

export default function App() {
  return (
    <SystemAnnouncerProvider>
      <div className="app-shell single-main">
        <main>
          <Routes>
            <Route path="/auth" element={<AuthPage />} />
            <Route path="/lobby" element={<LockstepArenaPage />} />
            <Route path="/" element={<Navigate to="/auth" replace />} />
            <Route path="*" element={<Navigate to="/auth" replace />} />
          </Routes>
        </main>
      </div>
    </SystemAnnouncerProvider>
  );
}
