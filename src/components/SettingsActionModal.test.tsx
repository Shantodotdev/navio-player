// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsActionModal } from "./SettingsActionModal";

describe("SettingsActionModal", () => {
  it("confirms the selected action without using a browser dialog", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();

    render(
      <SettingsActionModal
        isOpen
        title="Clear download history"
        description="Choose what to remove."
        actions={[
          { label: "Keep files", value: false },
          { label: "Delete files", value: true, destructive: true },
        ]}
        onConfirm={onConfirm}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Keep files" }));
    expect(onConfirm).toHaveBeenCalledWith(false);
  });
});
