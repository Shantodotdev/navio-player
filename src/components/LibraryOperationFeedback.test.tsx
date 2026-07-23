// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LibraryOperationFeedback } from "./LibraryOperationFeedback";

describe("LibraryOperationFeedback", () => {
  afterEach(cleanup);

  it("explains when Navio is waiting for folder selection", () => {
    render(<LibraryOperationFeedback activeScan={{ folder: null }} />);

    expect(screen.getByRole("status").textContent).toContain(
      "Choose a folder to scan",
    );
  });

  it("shows the selected folder during metadata scanning", () => {
    render(
      <LibraryOperationFeedback activeScan={{ folder: "C:\\Media" }} />,
    );

    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Scanning folder");
    expect(status.textContent).toContain("C:\\Media");
    expect(status.getAttribute("aria-busy")).toBe("true");
  });
});
