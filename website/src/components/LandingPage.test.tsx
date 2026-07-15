// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LandingPage } from "./LandingPage";

describe("LandingPage", () => {
  it("presents Navio's product story and primary Windows download action", () => {
    render(<LandingPage />);

    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /your media, finally in one place/i,
      }),
    ).toBeTruthy();
    expect(
      screen.getAllByRole("link", { name: /download for windows/i }),
    ).toHaveLength(3);
    expect(screen.getByText(/private by design/i)).toBeTruthy();
    expect(
      screen.getByRole("region", { name: /navio features/i }),
    ).toBeTruthy();
  });
});
