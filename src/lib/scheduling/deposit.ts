import type { DepositType } from "@prisma/client";

/** Valor do sinal em centavos (§9). Nunca maior que o preço do serviço. */
export function computeDepositCents(priceCents: number, type: DepositType, value: number): number {
  if (priceCents <= 0) return 0;
  switch (type) {
    case "percent": {
      const pct = Math.min(Math.max(value, 0), 100);
      return Math.round((priceCents * pct) / 100);
    }
    case "fixed":
      return Math.min(Math.max(value, 0), priceCents);
    default:
      return 0;
  }
}

/** Regras de cancelamento: dentro do prazo → reembolso; fora → sinal retido. */
export function isWithinCancelWindow(startsAt: Date, cancelLimitHours: number, now = new Date()): boolean {
  return startsAt.getTime() - now.getTime() >= cancelLimitHours * 3600_000;
}
