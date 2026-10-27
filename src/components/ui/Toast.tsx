"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

type ToastKind = "success" | "error" | "info" | "alert";
type ToastItem = { id: number; kind: ToastKind; message: string };

type ToastApi = {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  /** Something someone else did that needs the reader's attention (coach actions). */
  alert: (message: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const LIFETIME_MS: Record<ToastKind, number> = {
  success: 3500,
  info: 3500,
  // Alerts report another person's action: long enough to be noticed on return.
  alert: 9000,
  // Errors stay longer: they usually need reading, and often explain a refusal.
  error: 6000,
};

const KIND_CLS: Record<ToastKind, string> = {
  success: "bg-emerald-50 border-emerald-200 text-emerald-800",
  error:   "bg-rose-50 border-rose-200 text-rose-800",
  info:    "bg-slate-50 border-slate-200 text-slate-700",
  alert:   "bg-amber-50 border-amber-300 text-amber-900",
};

const KIND_ICON: Record<ToastKind, string> = {
  success: "M5 13l4 4L19 7",
  error:   "M6 18L18 6M6 6l12 12",
  info:    "M13 16h-1v-4h-1m1-4h.01",
  alert:   "M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 00-4-5.7V5a2 2 0 10-4 0v.3A6 6 0 006 11v3.2a2 2 0 01-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9",
};

/**
 * Minimal toast host. Wrap a subtree once; anything below can call `useToast()`.
 *
 * `role="status"` / `aria-live="polite"` so a screen reader announces the
 * confirmation of a toggle — otherwise the only feedback is visual.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) { clearTimeout(timer); timers.current.delete(id); }
  }, []);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = nextId.current++;
    // Cap the stack: a coach flicking several switches should see the latest
    // few, not a wall that covers the table they are working in.
    setItems((current) => [...current.slice(-3), { id, kind, message }]);
    timers.current.set(id, setTimeout(() => dismiss(id), LIFETIME_MS[kind]));
  }, [dismiss]);

  useEffect(() => {
    const live = timers.current;
    return () => { live.forEach(clearTimeout); live.clear(); };
  }, []);

  const api: ToastApi = {
    success: (m) => push("success", m),
    error:   (m) => push("error", m),
    info:    (m) => push("info", m),
    alert:   (m) => push("alert", m),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)] pointer-events-none"
        role="status"
        aria-live="polite"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2.5 rounded-xl border px-3.5 py-2.5 text-sm shadow-lift ${KIND_CLS[t.kind]}`}
          >
            <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d={KIND_ICON[t.kind]} />
            </svg>
            <p className="flex-1 leading-snug">{t.message}</p>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Fermer la notification"
              className="opacity-50 hover:opacity-100 -mr-1"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
