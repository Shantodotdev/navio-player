import { useCallback, useEffect, useRef, useState } from "react";
import {
  CircleAlert,
  CircleCheck,
  Info,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  toast,
  useToastStore,
  type ToastItem,
  type ToastVariant,
} from "../store/toastStore";

const TOAST_APPEARANCE: Record<
  ToastVariant,
  { Icon: LucideIcon; accent: string; icon: string }
> = {
  success: {
    Icon: CircleCheck,
    accent: "border-l-emerald-400",
    icon: "text-emerald-400",
  },
  error: {
    Icon: CircleAlert,
    accent: "border-l-red-400",
    icon: "text-red-400",
  },
  warning: {
    Icon: TriangleAlert,
    accent: "border-l-amber-400",
    icon: "text-amber-400",
  },
  info: {
    Icon: Info,
    accent: "border-l-brand-light",
    icon: "text-brand-light",
  },
};

const TOAST_EXIT_DURATION_MS = 280;

/** Renders Navio's application-wide notification stack above every route. */
export function ToastViewport() {
  const toasts = useToastStore((state) => state.toasts);

  if (toasts.length === 0) return null;

  return (
    <section
      aria-label="Notifications"
      className="pointer-events-none fixed right-4 top-12 z-150 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2.5"
    >
      {toasts.map((item) => (
        <ToastCard key={`${item.id}:${item.revision}`} item={item} />
      ))}
    </section>
  );
}

/** Renders one timed notification with optional recovery action. */
function ToastCard({ item }: { item: ToastItem }) {
  const dismiss = useToastStore((state) => state.dismiss);
  const { Icon, accent, icon } = TOAST_APPEARANCE[item.variant];
  const [isExiting, setIsExiting] = useState(false);
  const exitTimerRef = useRef<number | null>(null);

  /** Plays the short exit transition before removing the notification. */
  const requestDismiss = useCallback(() => {
    if (exitTimerRef.current !== null) return;
    setIsExiting(true);
    exitTimerRef.current = window.setTimeout(
      () => dismiss(item.id),
      TOAST_EXIT_DURATION_MS,
    );
  }, [dismiss, item.id]);

  useEffect(() => {
    if (item.durationMs === null) return;
    const timer = window.setTimeout(requestDismiss, item.durationMs);
    return () => window.clearTimeout(timer);
  }, [item.durationMs, item.revision, requestDismiss]);

  useEffect(
    () => () => {
      if (exitTimerRef.current !== null) {
        window.clearTimeout(exitTimerRef.current);
      }
    },
    [],
  );

  /** Dismisses first so repeated clicks cannot run an action more than once. */
  function runAction() {
    const action = item.action;
    if (!action) return;
    dismiss(item.id);
    try {
      const result = action.run();
      void Promise.resolve(result).catch(() => {
        toast.error("Action failed", {
          description: "Please try the operation again.",
        });
      });
    } catch {
      toast.error("Action failed", {
        description: "Please try the operation again.",
      });
    }
  }

  return (
    <article
      role={item.variant === "error" ? "alert" : "status"}
      aria-live={item.variant === "error" ? "assertive" : "polite"}
      className={`${isExiting ? "toast-exit" : "toast-enter"} pointer-events-auto flex gap-3 rounded-xl border border-white/10 border-l-2 ${accent} bg-[#0a0a0e]/96 p-3.5 shadow-2xl shadow-black/45 backdrop-blur-2xl`}
    >
      <Icon size={18} className={`mt-0.5 shrink-0 ${icon}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-zinc-100">{item.title}</p>
        {item.description ? (
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">
            {item.description}
          </p>
        ) : null}
        {item.action ? (
          <button
            type="button"
            onClick={runAction}
            className="mt-2 rounded-md border border-brand/35 bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand-light transition-colors hover:bg-brand/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50"
          >
            {item.action.label}
          </button>
        ) : null}
      </div>
      <button
        type="button"
        onClick={requestDismiss}
        aria-label="Dismiss notification"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-zinc-500 transition-colors hover:bg-white/10 hover:text-zinc-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
      >
        <X size={14} />
      </button>
    </article>
  );
}
