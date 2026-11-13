import type { CSSProperties, ReactNode } from "react";
import { RADIUS_PX, SPACING_PX, type Theme } from "@/lib/branding/theme";

function fontsHref(theme: Theme) {
  const fams = [...new Set([theme.fonts.heading, theme.fonts.body])]
    .map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;600;700`)
    .join("&");
  return `https://fonts.googleapis.com/css2?${fams}&display=swap`;
}

/** Aplica o tema do tenant via variáveis CSS (valores já validados pelo ThemeSchema). */
export function ThemeShell({ theme, children }: { theme: Theme; children: ReactNode }) {
  const radius = RADIUS_PX[theme.elements.radius];
  const style = {
    "--primary": theme.colors.primary,
    "--on-primary": theme.colors.onPrimary,
    "--secondary": theme.colors.secondary,
    "--bg": theme.colors.background,
    "--text": theme.colors.text,
    "--accent": theme.colors.accent,
    "--muted": theme.colors.muted,
    "--radius": theme.elements.buttonStyle === "pill" ? "9999px" : radius,
    "--radius-card": theme.elements.radius === "full" ? "24px" : radius,
    "--gap": SPACING_PX[theme.elements.spacing],
    "--font-heading": `"${theme.fonts.heading}"`,
    "--font-body": `"${theme.fonts.body}"`,
  } as CSSProperties;
  return (
    <>
      <link rel="stylesheet" href={fontsHref(theme)} />
      <div className="pub min-h-dvh" style={style}>
        {children}
      </div>
    </>
  );
}
