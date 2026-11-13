import { describe, expect, it } from "vitest";
import { computeDepositCents, isWithinCancelWindow } from "@/lib/scheduling/deposit";
import { normalizePhoneBR, parseBRL, slugify, isValidSlug } from "@/lib/format";
import { contrastRatio, finalizeTheme, sanitizeText, type AiTheme } from "@/lib/branding/theme";
import { encryptJson, decryptJson } from "@/lib/crypto";
import { signActionToken, verifyActionToken } from "@/lib/tokens";

describe("sinal", () => {
  it("percentual e fixo, nunca acima do preço", () => {
    expect(computeDepositCents(10000, "percent", 30)).toBe(3000);
    expect(computeDepositCents(4990, "percent", 30)).toBe(1497);
    expect(computeDepositCents(5000, "fixed", 8000)).toBe(5000);
    expect(computeDepositCents(5000, "none", 30)).toBe(0);
    expect(computeDepositCents(5000, "percent", 150)).toBe(5000);
  });
  it("janela de cancelamento", () => {
    const now = new Date("2026-11-10T12:00:00Z");
    expect(isWithinCancelWindow(new Date("2026-11-11T12:00:00Z"), 24, now)).toBe(true);
    expect(isWithinCancelWindow(new Date("2026-11-11T11:59:00Z"), 24, now)).toBe(false);
  });
});

describe("formatos", () => {
  it("telefone BR → E.164", () => {
    expect(normalizePhoneBR("(11) 98888-7777")).toBe("+5511988887777");
    expect(normalizePhoneBR("+55 21 3333-4444")).toBe("+552133334444");
    expect(normalizePhoneBR("5511988887777")).toBe("+5511988887777");
    expect(normalizePhoneBR("123")).toBeNull();
    expect(normalizePhoneBR("11888887777")).toBeNull(); // celular sem 9
  });
  it("dinheiro e slug", () => {
    expect(parseBRL("49,90")).toBe(4990);
    expect(parseBRL("1.200,00")).toBe(120000);
    expect(parseBRL("abc")).toBeNull();
    expect(slugify("Barbearia do João!")).toBe("barbearia-do-joao");
    expect(isValidSlug("admin")).toBe(false);
    expect(isValidSlug("studio-ana")).toBe(true);
  });
});

describe("tema gerado por IA (dado não confiável)", () => {
  const ai: AiTheme = {
    colors: { primary: "#ffff00", secondary: "#eeeeee", background: "#ffffff", text: "#dddddd", accent: "#ff0000" },
    fonts: { heading: "Poppins", body: "Inter" },
    style: "moderno",
    toneOfVoice: "Leve <script>alert(1)</script>",
    elements: { radius: "md", buttonStyle: "solid", cardStyle: "border", spacing: "comfortable" },
    copy: { headline: "<b>Studio</b> Ana", description: "Agende já", cta: "Agendar" },
    heroImageIndex: 1,
    galleryImageIndexes: [0, 1, 7],
    imageAltTexts: ["Logo", "Mesa de manicure"],
  };
  it("corrige contraste insuficiente e sanitiza textos", () => {
    const t = finalizeTheme(ai, ["m0", "m1"]);
    expect(contrastRatio(t.colors.text, t.colors.background)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(t.colors.onPrimary, t.colors.primary)).toBeGreaterThanOrEqual(4.5);
    expect(t.copy.headline).toBe("Studio Ana");
    expect(t.toneOfVoice).not.toContain("<");
    expect(t.heroMediaId).toBe("m1");
    expect(t.galleryMediaIds).toEqual(["m0", "m1"]); // índice 7 inexistente descartado
    expect(t.accessibility.altTexts.m1).toBe("Mesa de manicure");
  });
  it("rejeita cores fora do formato", () => {
    expect(() => finalizeTheme({ ...ai, colors: { ...ai.colors, primary: "red" } }, [])).toThrow();
  });
  it("sanitizeText remove controle e tags", () => {
    expect(sanitizeText("a\u0000b <i>c</i>", 10)).toBe("a b c");
  });
});

describe("segredos", () => {
  it("credenciais criptografadas ida e volta", () => {
    const enc = encryptJson({ accessToken: "segredo" });
    expect(enc).not.toContain("segredo");
    expect(decryptJson(enc)).toEqual({ accessToken: "segredo" });
  });
  it("token de ação assinado e com expiração", async () => {
    const t = await signActionToken("a1", "t1", new Date(Date.now() + 60_000));
    expect(await verifyActionToken(t)).toEqual({ aid: "a1", tid: "t1", pur: "manage" });
    expect(await verifyActionToken(t + "x")).toBeNull();
    const expired = await signActionToken("a1", "t1", new Date(Date.now() - 1000));
    expect(await verifyActionToken(expired)).toBeNull();
  });
});
