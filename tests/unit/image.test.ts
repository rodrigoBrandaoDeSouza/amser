import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { optimizeImage, sniffImage } from "@/lib/storage";

describe("otimização de imagem", () => {
  it("reduz para no máximo 1600 px, converte para WebP e remove metadados (GPS)", async () => {
    const big = await sharp({ create: { width: 4000, height: 3000, channels: 3, background: "#c06" } })
      .jpeg()
      .withExif({ IFD0: { Copyright: "teste" }, IFD3: { GPSLatitudeRef: "S", GPSLatitude: "23/1 33/1 0/1" } })
      .toBuffer();
    const out = await optimizeImage(big, "photo");
    expect(out.mime).toBe("image/webp");
    expect(sniffImage(out.data)?.mime).toBe("image/webp");
    const meta = await sharp(out.data).metadata();
    expect(Math.max(meta.width!, meta.height!)).toBe(1600);
    expect(meta.exif).toBeUndefined();
  });

  it("logo com transparência continua PNG", async () => {
    const logo = await sharp({ create: { width: 300, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const out = await optimizeImage(logo, "logo");
    expect(out.mime).toBe("image/png");
  });

  it("arquivo corrompido é recusado", async () => {
    const fake = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(100)]);
    await expect(optimizeImage(fake, "photo")).rejects.toThrow();
  });
});
