import { prisma } from "@/lib/db";
import { zonedToUtc } from "@/lib/time";

export const TZ = "America/Sao_Paulo";
/** Segunda-feira, 07/01/2030, 06:00 em SP — "agora" fixo dos testes. */
export const NOW = zonedToUtc("2030-01-07", "06:00", TZ);
export const DAY = "2030-01-07";
export const at = (hhmm: string, date = DAY) => zonedToUtc(date, hhmm, TZ);

export async function resetDb() {
  const tables = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

let n = 0;
export async function makeTenant(opts: { deposit?: { type: "percent" | "fixed"; value: number }; slug?: string } = {}) {
  n++;
  const tenant = await prisma.tenant.create({
    data: {
      name: `Empresa ${n}`,
      slug: opts.slug ?? `empresa-${n}-${Math.random().toString(36).slice(2, 6)}`,
      segment: "barbearia",
      status: "active",
      minAdvanceMinutes: 60,
      units: { create: { name: "Principal", timezone: TZ } },
    },
    include: { units: true },
  });
  const unit = tenant.units[0];
  const pros = [];
  for (const name of ["Ana", "Bia"]) {
    const pro = await prisma.professional.create({ data: { tenantId: tenant.id, unitId: unit.id, displayName: name } });
    for (let wd = 0; wd < 7; wd++) {
      await prisma.workingHour.create({ data: { tenantId: tenant.id, professionalId: pro.id, weekday: wd, startTime: "09:00", endTime: "18:00" } });
    }
    pros.push(pro);
  }
  const service = await prisma.service.create({
    data: {
      tenantId: tenant.id,
      name: "Corte",
      durationMinutes: 60,
      bufferMinutes: 10,
      priceCents: 10000,
      depositType: opts.deposit?.type ?? "none",
      depositValue: opts.deposit?.value ?? 0,
    },
  });
  for (const p of pros) await prisma.serviceProfessional.create({ data: { tenantId: tenant.id, serviceId: service.id, professionalId: p.id } });
  return { tenant, unit, pros, service };
}

export const customer = (phone = "11988887777") => ({ name: "Carla Souza", phone, consentWhatsapp: true });
