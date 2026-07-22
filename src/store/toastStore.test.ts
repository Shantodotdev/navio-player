import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast, useToastStore } from "./toastStore";

describe("toast queue", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it("assigns variant-specific default durations", () => {
    toast.success("Saved");
    toast.info("Ready");
    toast.warning("Check this");
    toast.error("Failed");

    expect(useToastStore.getState().toasts.map((item) => item.durationMs)).toEqual([
      4_000,
      4_000,
      6_000,
      8_000,
    ]);
  });

  it("refreshes a duplicate instead of stacking it", () => {
    const firstId = useToastStore.getState().show({
      variant: "error",
      title: "Scan failed",
      dedupeKey: "scan-folder",
    });
    toast.info("Another message");
    const refreshedId = useToastStore.getState().show({
      variant: "error",
      title: "Scan failed again",
      dedupeKey: "scan-folder",
    });

    const items = useToastStore.getState().toasts;
    expect(refreshedId).toBe(firstId);
    expect(items).toHaveLength(2);
    expect(items.at(-1)).toMatchObject({
      id: firstId,
      title: "Scan failed again",
    });
  });

  it("retains only the four newest notifications", () => {
    for (let index = 1; index <= 5; index += 1) {
      toast.info(`Message ${index}`);
    }

    expect(useToastStore.getState().toasts.map((item) => item.title)).toEqual([
      "Message 2",
      "Message 3",
      "Message 4",
      "Message 5",
    ]);
  });

  it("keeps persistent notifications when trimming the queue", () => {
    toast.error("Persistent", { durationMs: null });
    for (let index = 1; index <= 4; index += 1) {
      toast.info(`Temporary ${index}`);
    }

    expect(useToastStore.getState().toasts.map((item) => item.title)).toEqual([
      "Persistent",
      "Temporary 2",
      "Temporary 3",
      "Temporary 4",
    ]);
  });

  it("dismisses individual notifications and clears the queue", () => {
    const firstId = toast.success("One");
    toast.success("Two");

    useToastStore.getState().dismiss(firstId);
    expect(useToastStore.getState().toasts.map((item) => item.title)).toEqual([
      "Two",
    ]);

    useToastStore.getState().clear();
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it("preserves an optional action and explicit persistent duration", () => {
    const run = vi.fn();
    toast.error("Could not save", {
      durationMs: null,
      action: { label: "Retry", run },
    });

    expect(useToastStore.getState().toasts[0]).toMatchObject({
      durationMs: null,
      action: { label: "Retry", run },
    });
  });
});
