import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createBooking } from "@/lib/scheduling/booking";
import { NOW, at, customer, makeTenant, resetDb } from "./helpers";

/**
 * Estresse de concorrência: sob disputa, o Postgres pode gerar deadlock (40P01)
 * ou estourar o tempo da transação esperando lock (P2028). Esses erros são
 * transitórios e precisam ser retentados — nunca podem virar erro 500 nem
 * deixar de tentar o próximo profissional.
 */
describe("estresse de concorrência", () => {
  it("12 rodadas de 8 reservas simultâneas no mesmo horário com 2 profissionais → sempre exatamente 2", async () => {
    for (let round = 0; round < 12; round++) {
      await resetDb();
      const { tenant, service, pros } = await makeTenant();
      const input = { tenant, serviceId: service.id, professionalId: null, startsAt: at("10:00").toISOString(), source: "public" as const, now: NOW };
      const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => createBooking({ ...input, customer: customer(`1197777${7000 + i}`) })));
      const ok = results.filter((r) => r.status === "fulfilled");
      const unexpected = results.filter((r) => r.status === "rejected" && (r.reason as { code?: string }).code !== "slot_taken");
      expect(unexpected).toEqual([]);
      expect(ok).toHaveLength(2);
      const perPro = await prisma.appointment.groupBy({ by: ["professionalId"], _count: true });
      expect(perPro.map((p) => p._count).sort()).toEqual([1, 1]);
      expect(new Set(perPro.map((p) => p.professionalId))).toEqual(new Set(pros.map((p) => p.id)));
    }
  }, 300_000);
});
