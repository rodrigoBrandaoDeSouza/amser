import { z } from "zod";

export const FONTS = [
  "Inter",
  "Poppins",
  "Montserrat",
  "DM Sans",
  "Nunito",
  "Raleway",
  "Josefin Sans",
  "Oswald",
  "Bebas Neue",
  "Playfair Display",
  "Lora",
  "Cormorant Garamond",
] as const;

export const STYLES = ["minimalista", "premium", "moderno", "delicado", "urbano", "natural", "vibrante"] as const;

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "cor HEX #RRGGBB");

/** Saída que a IA deve produzir (§6). Sem serviços, preços ou depoimentos. */
export const AiThemeSchema = z.object({
  colors: z.object({ primary: hex, secondary: hex, background: hex, text: hex, accent: hex }),
  fonts: z.object({ heading: z.enum(FONTS), body: z.enum(FONTS) }),
  style: z.enum(STYLES),
  toneOfVoice: z.string().max(160),
  elements: z.object({
    radius: z.enum(["none", "sm", "md", "lg", "full"]),
    buttonStyle: z.enum(["solid", "outline", "pill"]),
    cardStyle: z.enum(["flat", "shadow", "border"]),
    spacing: z.enum(["compact", "comfortable", "airy"]),
  }),
  copy: z.object({
    headline: z.string().max(80),
    description: z.string().max(300),
    cta: z.string().max(30),
  }),
  heroImageIndex: z.number().int().min(-1),
  galleryImageIndexes: z.array(z.number().int().min(0)),
  imageAltTexts: z.array(z.string().max(160)),
});
export type AiTheme = z.infer<typeof AiThemeSchema>;

/** Tema salvo (versão validada + campos calculados pela aplicação). */
export const ThemeSchema = z.object({
  colors: z.object({ primary: hex, secondary: hex, background: hex, text: hex, accent: hex, onPrimary: hex, muted: hex }),
  fonts: z.object({ heading: z.enum(FONTS), body: z.enum(FONTS) }),
  style: z.enum(STYLES),
  toneOfVoice: z.string().max(160),
  elements: AiThemeSchema.shape.elements,
  copy: AiThemeSchema.shape.copy,
  heroMediaId: z.string().nullable(),
  galleryMediaIds: z.array(z.string()).max(12),
  accessibility: z.object({
    textOnBackground: z.number(),
    onPrimary: z.number(),
    altTexts: z.record(z.string(), z.string().max(160)),
  }),
});
export type Theme = z.infer<typeof ThemeSchema>;

// ---------- Contraste (WCAG 2.x) ----------

function channel(c: number) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function luminance(hexColor: string): number {
  const n = parseInt(hexColor.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrastRatio(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100;
}

const DARK = "#111111";
const LIGHT = "#ffffff";

export function bestTextOn(bg: string): string {
  return contrastRatio(DARK, bg) >= contrastRatio(LIGHT, bg) ? DARK : LIGHT;
}

function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.slice(1), 16);
  const pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round(((pa >> shift) & 255) * (1 - t) + ((pb >> shift) & 255) * t);
  return `#${[16, 8, 0].map((s) => ch(s).toString(16).padStart(2, "0")).join("")}`;
}

/** Remove marcação e caracteres de controle de textos vindos da IA. */
export function sanitizeText(s: string, max: number): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

/**
 * Converte a saída da IA (dado NÃO confiável) em tema seguro: valida,
 * sanitiza textos, garante contraste mínimo 4.5:1 e mapeia imagens para IDs.
 */
export function finalizeTheme(ai: AiTheme, mediaIds: string[]): Theme {
  const parsed = AiThemeSchema.parse(ai);
  const c = { ...parsed.colors };
  if (contrastRatio(c.text, c.background) < 4.5) c.text = bestTextOn(c.background);
  const onPrimary = bestTextOn(c.primary);
  // Se nem preto nem branco atingem 4.5 sobre a primária, escurece/clareia a primária.
  let primary = c.primary;
  for (let i = 0; i < 10 && contrastRatio(onPrimary, primary) < 4.5; i++) {
    primary = mix(primary, onPrimary === LIGHT ? "#000000" : "#ffffff", 0.12);
  }
  c.primary = primary;

  const pick = (i: number) => (i >= 0 && i < mediaIds.length ? mediaIds[i] : null);
  const altTexts: Record<string, string> = {};
  mediaIds.forEach((id, i) => {
    altTexts[id] = sanitizeText(parsed.imageAltTexts[i] ?? "Foto do estabelecimento", 160) || "Foto do estabelecimento";
  });

  return ThemeSchema.parse({
    colors: { ...c, onPrimary, muted: mix(c.text, c.background, 0.45) },
    fonts: parsed.fonts,
    style: parsed.style,
    toneOfVoice: sanitizeText(parsed.toneOfVoice, 160),
    elements: parsed.elements,
    copy: {
      headline: sanitizeText(parsed.copy.headline, 80),
      description: sanitizeText(parsed.copy.description, 300),
      cta: sanitizeText(parsed.copy.cta, 30) || "Agendar",
    },
    heroMediaId: pick(parsed.heroImageIndex),
    galleryMediaIds: [...new Set(parsed.galleryImageIndexes.map(pick).filter((x): x is string => !!x))].slice(0, 12),
    accessibility: {
      textOnBackground: contrastRatio(c.text, c.background),
      onPrimary: contrastRatio(onPrimary, primary),
      altTexts,
    },
  });
}

/** Revalida um tema editado manualmente no painel. */
export function normalizeEditedTheme(theme: Theme): Theme {
  const t = ThemeSchema.parse(theme);
  const c = { ...t.colors };
  if (contrastRatio(c.text, c.background) < 4.5) c.text = bestTextOn(c.background);
  c.onPrimary = bestTextOn(c.primary);
  c.muted = mix(c.text, c.background, 0.45);
  return {
    ...t,
    colors: c,
    copy: {
      headline: sanitizeText(t.copy.headline, 80),
      description: sanitizeText(t.copy.description, 300),
      cta: sanitizeText(t.copy.cta, 30) || "Agendar",
    },
    accessibility: { ...t.accessibility, textOnBackground: contrastRatio(c.text, c.background), onPrimary: contrastRatio(c.onPrimary, c.primary) },
  };
}

export const RADIUS_PX: Record<Theme["elements"]["radius"], string> = { none: "0px", sm: "6px", md: "12px", lg: "20px", full: "9999px" };
export const SPACING_PX: Record<Theme["elements"]["spacing"], string> = { compact: "12px", comfortable: "18px", airy: "26px" };

export function defaultTheme(name: string): Theme {
  return finalizeTheme(
    {
      colors: { primary: "#1f2937", secondary: "#f3f4f6", background: "#ffffff", text: "#111827", accent: "#d97706" },
      fonts: { heading: "Poppins", body: "Inter" },
      style: "moderno",
      toneOfVoice: "Acolhedor e direto",
      elements: { radius: "md", buttonStyle: "solid", cardStyle: "border", spacing: "comfortable" },
      copy: { headline: name, description: "Agende seu horário online em poucos passos.", cta: "Agendar horário" },
      heroImageIndex: -1,
      galleryImageIndexes: [],
      imageAltTexts: [],
    },
    [],
  );
}
