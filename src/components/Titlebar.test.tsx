// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const windowApi = vi.hoisted(() => ({
  close: vi.fn(),
  isDecorated: vi.fn<() => Promise<boolean>>(),
  minimize: vi.fn(),
  toggleMaximize: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => windowApi,
}));

type TauriWindow = Window & { __TAURI_INTERNALS__?: unknown };

describe("Titlebar", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    delete (window as TauriWindow).__TAURI_INTERNALS__;
  });

  it("keeps the custom titlebar in browser development", async () => {
    const { Titlebar } = await import("./Titlebar");
    const view = render(<Titlebar />);

    expect(view.container.firstElementChild).not.toBeNull();
    expect(windowApi.isDecorated).not.toHaveBeenCalled();
  });

  it("renders custom controls for an undecorated Tauri window", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    windowApi.isDecorated.mockResolvedValue(false);
    const { Titlebar } = await import("./Titlebar");
    const view = render(<Titlebar />);

    await waitFor(() => expect(windowApi.isDecorated).toHaveBeenCalledOnce());
    expect(view.container.firstElementChild).not.toBeNull();
  });

  it("omits custom controls for a decorated Tauri window", async () => {
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      configurable: true,
      value: {},
    });
    windowApi.isDecorated.mockResolvedValue(true);
    const { Titlebar } = await import("./Titlebar");
    const view = render(<Titlebar />);

    await waitFor(() => expect(windowApi.isDecorated).toHaveBeenCalledOnce());
    expect(view.container.firstElementChild).toBeNull();
  });
});
