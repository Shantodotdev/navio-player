import { describe, expect, it } from "vitest";
import { getErrorMessage } from "./errorMessage";

describe("getErrorMessage", () => {
  it("preserves and trims Error messages", () => {
    expect(
      getErrorMessage(new Error("  Disk is unavailable.  "), "Fallback"),
    ).toBe("Disk is unavailable.");
  });

  it("preserves and trims backend string errors", () => {
    expect(getErrorMessage("  Folder cannot be read. ", "Fallback")).toBe(
      "Folder cannot be read.",
    );
  });

  it("uses the operation fallback for unknown or empty errors", () => {
    expect(getErrorMessage("   ", "  Could not save.  ")).toBe(
      "Could not save.",
    );
    expect(
      getErrorMessage({ message: "private detail" }, "Could not save."),
    ).toBe("Could not save.");
    expect(getErrorMessage(null, "Could not save.")).toBe("Could not save.");
  });

  it("uses a safe generic message when the fallback is empty", () => {
    expect(getErrorMessage(undefined, "   ")).toBe("Something went wrong.");
  });

  it("replaces multiline and stack-like technical messages", () => {
    expect(
      getErrorMessage(
        new Error("Save failed\n    at persistSettings (settings.ts:20)"),
        "Could not save settings.",
      ),
    ).toBe("Could not save settings.");
  });

  it("does not expose absolute local paths or oversized messages", () => {
    expect(
      getErrorMessage(
        "Could not read C:\\Users\\person\\private\\settings.json",
        "Could not read local settings.",
      ),
    ).toBe("Could not read local settings.");
    expect(getErrorMessage("x".repeat(241), "Operation failed.")).toBe(
      "Operation failed.",
    );
    expect(
      getErrorMessage(
        "Could not read /Volumes/Media/private/library.json",
        "Could not read local settings.",
      ),
    ).toBe("Could not read local settings.");
    expect(
      getErrorMessage(
        "Could not read /mnt/media/private/library.json",
        "Could not read local settings.",
      ),
    ).toBe("Could not read local settings.");
  });

  it("replaces concise technical diagnostics with operation feedback", () => {
    expect(
      getErrorMessage(
        "SQLITE_CONSTRAINT: UNIQUE constraint failed: playlists.name",
        "Could not save playlist.",
      ),
    ).toBe("Could not save playlist.");
    expect(
      getErrorMessage(
        "Process error: exit code 1; stderr unavailable",
        "Download could not start.",
      ),
    ).toBe("Download could not start.");
    expect(
      getErrorMessage(
        "RuntimeError: invalid internal state",
        "Operation failed.",
      ),
    ).toBe("Operation failed.");
  });
});
