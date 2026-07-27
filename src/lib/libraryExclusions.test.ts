import { describe, expect, it } from "vitest";
import { parseLibraryExclusions } from "./libraryExclusions";

describe("library exclusion parsing", () => {
  it("accepts commas and lines while removing empty and duplicate names", () => {
    expect(
      parseLibraryExclusions("node_modules, target\n.git\nTARGET, "),
    ).toEqual(["node_modules", "target", ".git"]);
  });
});
