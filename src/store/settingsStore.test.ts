// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, useSettingsStore } from "./settingsStore";

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));

describe("Navio settings defaults", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    useSettingsStore.setState({
      settings: structuredClone(DEFAULT_SETTINGS),
      lastPersistedSettings: structuredClone(DEFAULT_SETTINGS),
      isLoaded: true,
    });
  });

  it("starts with the requested player and library preferences", () => {
    expect(DEFAULT_SETTINGS.playback.volume).toBe(80);
    expect(DEFAULT_SETTINGS.playback.playVideoInSidebar).toBe(false);
    expect(DEFAULT_SETTINGS.library.viewMode).toBe("list");
    expect(DEFAULT_SETTINGS.library.showThumbnails).toBe(true);
    expect(DEFAULT_SETTINGS.library.showFileExtensions).toBe(false);
  });

  it("restores the prior settings when persistence fails", async () => {
    invokeMock.mockRejectedValue(new Error("Settings file is unavailable."));

    await expect(
      useSettingsStore
        .getState()
        .updateSettings({ library: { viewMode: "grid" } }),
    ).rejects.toThrow("Settings file is unavailable.");

    expect(useSettingsStore.getState().settings.library.viewMode).toBe("list");
  });

  it("does not roll back a newer setting after an older save fails", async () => {
    let rejectFirst: (reason?: unknown) => void = () => undefined;
    invokeMock
      .mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockResolvedValueOnce(undefined);

    const firstSave = useSettingsStore
      .getState()
      .updateSettings({ library: { viewMode: "grid" } });
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    const secondSave = useSettingsStore
      .getState()
      .updateSettings({ library: { showThumbnails: false } });
    rejectFirst(new Error("Older save failed."));
    await expect(firstSave).rejects.toThrow("Older save failed.");
    await secondSave;

    expect(useSettingsStore.getState().settings.library).toMatchObject({
      viewMode: "grid",
      showThumbnails: false,
    });
  });

  it("persists rapid successful updates in the order they were made", async () => {
    const resolveSaves: Array<() => void> = [];
    invokeMock.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSaves.push(resolve);
        }),
    );

    const firstSave = useSettingsStore
      .getState()
      .updateSettings({ library: { viewMode: "grid" } });
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));

    const secondSave = useSettingsStore
      .getState()
      .updateSettings({ library: { showThumbnails: false } });
    await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledTimes(1);

    resolveSaves[0]?.();
    await firstSave;
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(2));
    resolveSaves[1]?.();
    await secondSave;

    expect(invokeMock.mock.calls[1]?.[1]).toMatchObject({
      settings: {
        library: { view_mode: "grid", show_thumbnails: false },
      },
    });
  });

  it("rolls repeated failures back to the last confirmed snapshot", async () => {
    invokeMock.mockRejectedValue(new Error("Settings file is unavailable."));

    const firstSave = useSettingsStore
      .getState()
      .updateSettings({ library: { viewMode: "grid" } });
    const secondSave = useSettingsStore
      .getState()
      .updateSettings({ library: { showThumbnails: false } });

    await expect(firstSave).rejects.toThrow("Settings file is unavailable.");
    await expect(secondSave).rejects.toThrow("Settings file is unavailable.");
    expect(useSettingsStore.getState().settings.library).toMatchObject({
      viewMode: "list",
      showThumbnails: true,
    });
  });

  it("waits for pending settings writes before resetting local databases", async () => {
    let resolveSave: () => void = () => undefined;
    invokeMock.mockImplementation((command: string) => {
      if (command === "save_settings") {
        return new Promise<void>((resolve) => {
          resolveSave = resolve;
        });
      }
      return Promise.resolve();
    });

    const save = useSettingsStore
      .getState()
      .updateSettings({ library: { viewMode: "grid" } });
    await vi.waitFor(() => expect(invokeMock).toHaveBeenCalledTimes(1));
    const reset = useSettingsStore.getState().resetDatabases();
    await Promise.resolve();
    expect(invokeMock).toHaveBeenCalledTimes(1);

    resolveSave();
    await save;
    await reset;
    expect(invokeMock.mock.calls.map(([command]) => command)).toEqual([
      "save_settings",
      "reset_databases",
    ]);
  });
});
