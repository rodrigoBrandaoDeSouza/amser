import { describe, expect, it } from "vitest";
import { normalizeInstagramHandle } from "@/lib/instagram/handle";

describe("normalizeInstagramHandle", () => {
  it.each([
    ["crisaguilera.1", "crisaguilera.1"],
    ["@crisaguilera.1", "crisaguilera.1"],
    ["https://www.instagram.com/crisaguilera.1", "crisaguilera.1"],
    ["https://www.instagram.com/crisaguilera.1/?hl=pt-br", "crisaguilera.1"],
    ["instagram.com/studio_ana", "studio_ana"],
    ["  @studio_ana  ", "studio_ana"],
  ])("%s → %s", (raw, expected) => {
    expect(normalizeInstagramHandle(raw)).toBe(expected);
  });

  it.each(["", "   ", "@", "https://www.instagram.com/", "nome com espaço", null, undefined])("rejeita %s", (raw) => {
    expect(normalizeInstagramHandle(raw)).toBeNull();
  });
});
