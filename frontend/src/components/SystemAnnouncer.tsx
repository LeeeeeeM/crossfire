import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type AnnouncementTone = "info" | "good" | "bad";

export type Announcement = {
  id: string;
  title: string;
  subtitle?: string;
  tone?: AnnouncementTone;
  durationMs?: number;
};

type Ctx = {
  announce: (a: Omit<Announcement, "id">) => void;
  /** 对战时传入画布容器内的节点，提示会出现在该节点内（画布左上角区域） */
  registerAnnounceAnchor: (el: HTMLElement | null) => void;
};

const AnnouncerContext = createContext<Ctx | null>(null);

function uid() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function SystemAnnouncerProvider({ children }: { children: React.ReactNode }) {
  const [queue, setQueue] = useState<Announcement[]>([]);
  const [current, setCurrent] = useState<Announcement | null>(null);
  const [announceAnchorEl, setAnnounceAnchorEl] = useState<HTMLElement | null>(null);
  const timerRef = useRef<number | null>(null);

  const announce = useCallback((a: Omit<Announcement, "id">) => {
    const item: Announcement = { id: uid(), tone: "info", durationMs: 1600, ...a };
    setQueue((q) => [...q, item]);
  }, []);

  const registerAnnounceAnchor = useCallback((el: HTMLElement | null) => {
    setAnnounceAnchorEl(el);
  }, []);

  useEffect(() => {
    if (current || queue.length === 0) return;
    const next = queue[0];
    setCurrent(next);
    setQueue((q) => q.slice(1));
  }, [current, queue]);

  useEffect(() => {
    if (!current) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setCurrent(null);
    }, Math.max(400, current.durationMs || 0));
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [current]);

  const value = useMemo<Ctx>(() => ({ announce, registerAnnounceAnchor }), [announce, registerAnnounceAnchor]);

  return (
    <AnnouncerContext.Provider value={value}>
      {children}
      <SystemAnnouncerOverlay announcement={current} anchorEl={announceAnchorEl} />
    </AnnouncerContext.Provider>
  );
}

export function useSystemAnnouncer() {
  const ctx = useContext(AnnouncerContext);
  if (!ctx) throw new Error("useSystemAnnouncer must be used within SystemAnnouncerProvider");
  return ctx;
}

function SystemAnnouncerOverlay({
  announcement,
  anchorEl
}: {
  announcement: Announcement | null;
  anchorEl: HTMLElement | null;
}) {
  const [visible, setVisible] = useState(false);
  const lastIdRef = useRef<string>("");

  useEffect(() => {
    if (!announcement) {
      setVisible(false);
      return;
    }
    if (announcement.id !== lastIdRef.current) {
      lastIdRef.current = announcement.id;
      setVisible(true);
    }
  }, [announcement]);

  const tone = announcement?.tone || "info";
  const mode = anchorEl ? "sys-announce--canvas" : "sys-announce--viewport";
  const cls = `sys-announce ${mode} ${visible ? "show" : ""} tone-${tone}`;

  const node = (
    <div className={cls} aria-live="polite" aria-atomic="true">
      <div className="sys-announce-card">
        <div className="sys-announce-title">{announcement?.title || ""}</div>
        {announcement?.subtitle ? <div className="sys-announce-subtitle">{announcement.subtitle}</div> : null}
      </div>
    </div>
  );

  return createPortal(node, anchorEl ?? document.body);
}

