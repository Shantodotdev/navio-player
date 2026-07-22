// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast, useToastStore } from "../store/toastStore";
import { ToastViewport } from "./ToastViewport";

describe("ToastViewport", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders polite and assertive notifications with their descriptions", () => {
    toast.success("Folder added", { description: "Music is ready." });
    toast.error("Scan failed", { description: "Try the folder again." });

    render(<ToastViewport />);

    expect(screen.getByRole("status").textContent).toContain("Folder added");
    expect(screen.getByRole("status").textContent).toContain("Music is ready.");
    expect(screen.getByRole("alert").textContent).toContain("Scan failed");
  });

  it("animates a notification out from its close control", () => {
    vi.useFakeTimers();
    toast.info("Library refreshed");
    render(<ToastViewport />);

    fireEvent.click(
      screen.getByRole("button", { name: "Dismiss notification" }),
    );
    expect(screen.getByRole("status").className).toContain("toast-exit");

    act(() => vi.advanceTimersByTime(280));

    expect(screen.queryByText("Library refreshed")).toBeNull();
  });

  it("automatically dismisses a notification after its duration", () => {
    vi.useFakeTimers();
    toast.info("Short message", { durationMs: 1_000 });
    render(<ToastViewport />);

    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByRole("status").className).toContain("toast-exit");

    act(() => vi.advanceTimersByTime(280));

    expect(screen.queryByText("Short message")).toBeNull();
  });

  it("restarts dismissal timing when a duplicate is refreshed", () => {
    vi.useFakeTimers();
    toast.info("Refreshing", { dedupeKey: "refresh", durationMs: 1_000 });
    render(<ToastViewport />);

    act(() => vi.advanceTimersByTime(900));
    act(() => {
      toast.info("Refreshed", { dedupeKey: "refresh", durationMs: 1_000 });
    });
    act(() => vi.advanceTimersByTime(200));
    expect(screen.queryByText("Refreshed")).not.toBeNull();

    act(() => vi.advanceTimersByTime(800));
    expect(screen.queryByText("Refreshed")).not.toBeNull();
    act(() => vi.advanceTimersByTime(280));
    expect(screen.queryByText("Refreshed")).toBeNull();
  });

  it("revives a duplicate that arrives during its exit transition", () => {
    vi.useFakeTimers();
    toast.info("Expiring", { dedupeKey: "revive", durationMs: 1_000 });
    render(<ToastViewport />);

    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.getByRole("status").className).toContain("toast-exit");

    act(() => {
      toast.info("Still working", {
        dedupeKey: "revive",
        durationMs: 1_000,
      });
    });
    expect(screen.getByRole("status").className).toContain("toast-enter");

    act(() => vi.advanceTimersByTime(999));
    expect(screen.queryByText("Still working")).not.toBeNull();
  });

  it("dismisses before running an action once", () => {
    const run = vi.fn(() => {
      expect(useToastStore.getState().toasts).toHaveLength(0);
    });
    toast.error("Save failed", {
      durationMs: null,
      action: { label: "Retry", run },
    });
    render(<ToastViewport />);

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Save failed")).toBeNull();
  });
});
