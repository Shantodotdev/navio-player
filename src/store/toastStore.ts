import { create } from "zustand";

export type ToastVariant = "success" | "error" | "warning" | "info";

export interface ToastAction {
  label: string;
  run: () => void | Promise<void>;
}

export interface ToastInput {
  variant: ToastVariant;
  title: string;
  description?: string;
  dedupeKey?: string;
  durationMs?: number | null;
  action?: ToastAction;
}

export interface ToastItem extends ToastInput {
  id: string;
  durationMs: number | null;
  /** Increments when a duplicate refreshes so render-owned timers restart. */
  revision: number;
}

interface ToastState {
  toasts: ToastItem[];
  show: (input: ToastInput) => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

type ToastOptions = Omit<ToastInput, "variant" | "title">;

const MAX_VISIBLE_TOASTS = 4;
const DEFAULT_DURATIONS: Record<ToastVariant, number> = {
  success: 4_000,
  info: 4_000,
  warning: 6_000,
  error: 8_000,
};
let fallbackId = 0;

/** Generates a session-unique notification ID in browsers and test environments. */
function createToastId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  fallbackId += 1;
  return `toast-${Date.now()}-${fallbackId}`;
}

/** Resolves the stable identity used to refresh repeated notifications. */
function resolveDedupeKey(input: ToastInput): string {
  return (
    input.dedupeKey ??
    `${input.variant}\u0000${input.title}\u0000${input.description ?? ""}`
  );
}

/** Bounds the stack while preferring to keep explicitly persistent failures. */
function trimToastQueue(items: ToastItem[]): ToastItem[] {
  if (items.length <= MAX_VISIBLE_TOASTS) return items;
  const removableIndex = items.findIndex((item) => item.durationMs !== null);
  const index = removableIndex === -1 ? 0 : removableIndex;
  return items.filter((_, itemIndex) => itemIndex !== index);
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  show: (input) => {
    let resolvedId = "";
    set((state) => {
      const dedupeKey = resolveDedupeKey(input);
      const existing = state.toasts.find(
        (item) => resolveDedupeKey(item) === dedupeKey,
      );
      resolvedId = existing?.id ?? createToastId();
      const refreshed: ToastItem = {
        ...input,
        id: resolvedId,
        revision: (existing?.revision ?? 0) + 1,
        durationMs:
          input.durationMs === undefined
            ? DEFAULT_DURATIONS[input.variant]
            : input.durationMs,
      };
      const withoutDuplicate = state.toasts.filter(
        (item) => item.id !== resolvedId,
      );
      return {
        toasts: trimToastQueue([...withoutDuplicate, refreshed]),
      };
    });
    return resolvedId;
  },
  dismiss: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((item) => item.id !== id),
    })),
  clear: () => set({ toasts: [] }),
}));

/** Shows one notification variant through the global store. */
function showVariant(
  variant: ToastVariant,
  title: string,
  options: ToastOptions = {},
): string {
  return useToastStore.getState().show({ variant, title, ...options });
}

export const toast = {
  success: (title: string, options?: ToastOptions) =>
    showVariant("success", title, options),
  error: (title: string, options?: ToastOptions) =>
    showVariant("error", title, options),
  warning: (title: string, options?: ToastOptions) =>
    showVariant("warning", title, options),
  info: (title: string, options?: ToastOptions) =>
    showVariant("info", title, options),
};
