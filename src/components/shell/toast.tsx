"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { XIcon } from "lucide-react";
import Link from "@/components/link";
import { Button } from "@/components/ui/button";

export type ToastTone = "green" | "red" | "neutral";

/** What an undo callback may return: an action result, or nothing. */
type UndoResult = { ok: boolean; error?: string } | void;

export type ToastInput = {
  /** green = something was saved (default), red = something failed, neutral = information. */
  tone?: ToastTone;
  text: string;
  /** Reverses the write. Must be safe to call twice. Omit when there is no server inverse. */
  undo?: () => Promise<UndoResult> | UndoResult;
  /** A link to the record the message is about, e.g. "Open task". */
  link?: { label: string; href: string };
  /** Milliseconds on screen. Default 8000 with Undo, 5000 otherwise; errors stay 8000. */
  duration?: number;
};

type ToastItem = ToastInput & { id: number; tone: ToastTone };

type ToastApi = {
  /** Shows a status message in the app's polite live region. Returns its id. */
  show: (toast: ToastInput) => number;
  dismiss: (id: number) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

const MAX_VISIBLE = 3;
// Dialogs mark everything outside them aria-hidden while open; a short delay lets a
// dialog that just closed release the page so the announcement is not swallowed.
const SHOW_DELAY_MS = 60;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((all) => all.filter((t) => t.id !== id));
  }, []);

  const show = useCallback((toast: ToastInput) => {
    const id = nextId.current++;
    const item: ToastItem = { ...toast, id, tone: toast.tone ?? "green" };
    window.setTimeout(() => setItems((all) => [...all, item].slice(-MAX_VISIBLE)), SHOW_DELAY_MS);
    return id;
  }, []);

  const api = useMemo(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite" aria-relevant="additions text">
        {items.map((t) => (
          <Toast key={t.id} item={t} dismiss={dismiss} show={show} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function Toast({
  item,
  dismiss,
  show,
}: {
  item: ToastItem;
  dismiss: ToastApi["dismiss"];
  show: ToastApi["show"];
}) {
  // Stable per toast, so another toast arriving does not restart this one's timer.
  const onDismiss = useCallback(() => dismiss(item.id), [dismiss, item.id]);
  const [paused, setPaused] = useState(false);
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const duration = item.duration ?? (item.undo || item.tone === "red" ? 8000 : 5000);

  useEffect(() => {
    if (paused || busy) return;
    const timer = window.setTimeout(onDismiss, duration);
    return () => window.clearTimeout(timer);
  }, [paused, busy, duration, onDismiss]);

  const undo = async () => {
    // A double click (or a retry while the first request is in flight) must not run twice.
    if (!item.undo || running.current) return;
    running.current = true;
    setBusy(true);
    try {
      const result = await item.undo();
      onDismiss();
      if (result && !result.ok) {
        show({ tone: "red", text: result.error ?? "Couldn’t undo. Try again." });
      } else {
        show({ tone: "neutral", text: "Undone", duration: 3000 });
      }
    } catch {
      onDismiss();
      show({ tone: "red", text: "Couldn’t undo. Try again." });
    }
  };

  return (
    <div
      className={`toast ${item.tone} animate-in fade-in-0 slide-in-from-bottom-2`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <span className="toast-text">{item.text}</span>
      {item.link ? (
        <Link className="btn ghost sm toast-undo" href={item.link.href} onClick={onDismiss}>
          {item.link.label}
        </Link>
      ) : null}
      {item.undo ? (
        <Button size="sm" variant="ghost" className="toast-undo" disabled={busy} onClick={undo}>
          {busy ? "Undoing…" : "Undo"}
        </Button>
      ) : null}
      <Button size="icon-sm" variant="ghost" aria-label="Dismiss" onClick={onDismiss}>
        <XIcon size={14} aria-hidden />
      </Button>
    </div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used inside <ToastProvider>");
  return ctx;
}
