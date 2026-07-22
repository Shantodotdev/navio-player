// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToastStore } from "../store/toastStore";
import { CreatePlaylistModal } from "./CreatePlaylistModal";

describe("CreatePlaylistModal feedback", () => {
  beforeEach(() => useToastStore.setState({ toasts: [] }));
  afterEach(cleanup);

  it("shows persistence failures in the global notification queue", async () => {
    const create = vi
      .fn()
      .mockRejectedValue(new Error("Could not write playlists data."));
    render(<CreatePlaylistModal onPlaylistCreated={create} />);

    fireEvent.click(screen.getByRole("button", { name: "New playlist" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Playlist name" }), {
      target: { value: "Favorites" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create playlist" }));

    await waitFor(() =>
      expect(useToastStore.getState().toasts[0]).toMatchObject({
        variant: "error",
        title: "Could not create playlist",
      }),
    );
  });

  it("keeps known naming validation inline without a global notification", async () => {
    const create = vi
      .fn()
      .mockRejectedValue(
        new Error("A playlist with this name already exists."),
      );
    render(<CreatePlaylistModal onPlaylistCreated={create} />);

    fireEvent.click(screen.getByRole("button", { name: "New playlist" }));
    fireEvent.change(screen.getByRole("textbox", { name: "Playlist name" }), {
      target: { value: "Favorites" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create playlist" }));

    await screen.findByText("A playlist with this name already exists.");
    expect(useToastStore.getState().toasts).toEqual([]);
  });
});
