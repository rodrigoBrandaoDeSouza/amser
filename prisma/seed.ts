/**
 * Seed de desenvolvimento (§18.6): superadmin, planos, dois tenants de
 * segmentos diferentes (um COM sinal obrigatório, outro SEM) e uma prévia de
 * prospect. Demonstra o isolamento entre tenants.
 *
 * Uso: npm run db:seed   (recusa rodar em produção)
 */
import zlib from "node:zlib";
import { PrismaClient, type Prisma } from "@prisma/client";
import { hashPassword } from "../src/lib/auth/password";
import { finalizeTheme } from "../src/lib/branding/theme";
import { mockAnalyzer } from "../src/lib/branding/analyze";
import { storage } from "../src/lib/storage";
import { randomToken } from "../src/lib/crypto";
import { startTrial } from "../src/lib/billing/service";

try {
  process.loadEnvFile(".env");
} catch {
  /* variáveis já no ambiente */
}
if (process.env.NODE_ENV === "production") {
  console.error("Seed de desenvolvimento não roda em produção.");
  process.exit(1);
}

const prisma = new PrismaClient();
const PASSWORD = process.env.SEED_PASSWORD ?? "amser-dev-123";

/** PNG sólido com faixa diagonal (imagem de demonstração, sem direitos de terceiros). */
function demoPng(rgb: [number, number, number], rgb2: [number, number, number], size = 480): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const band = Math.abs(x - y) < size / 6;
      const [r, g, b] = band ? rgb2 : rgb;
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

async function addMedia(tenantId: string, kind: "logo" | "photo", png: Buffer) {
  const key = await storage().put(tenantId, png, "png", "image/png");
  return prisma.tenantMedia.create({
    data: { tenantId, kind, storageKey: key, mimeType: "image/png", sizeBytes: png.length, rightsConfirmed: true, rightsConfirmedBy: "seed" },
  });
}

async function brand(tenantId: string, name: string, segment: string, status: "draft" | "published") {
  const media = await prisma.tenantMedia.findMany({ where: { tenantId }, orderBy: [{ kind: "asc" }, { createdAt: "asc" }] });
  const ai = await mockAnalyzer.analyze({
    name,
    segment,
    images: media.map((m) => ({ mime: "image/png" as const, data: Buffer.alloc(0), isLogo: m.kind === "logo" })),
  });
  const theme = finalizeTheme(ai, media.map((m) => m.id));
  await prisma.tenantBranding.create({
    data: { tenantId, themeJson: theme as unknown as Prisma.InputJsonValue, sourceMetadataJson: { analyzer: "seed" }, version: 1, status },
  });
}

async function makeTenant(opts: {
  name: string;
  slug: string;
  segment: string;
  ownerEmail: string;
  planId: string;
  colors: [[number, number, number], [number, number, number]];
  services: { name: string; minutes: number; cents: number; buffer?: number; deposit?: { type: "percent" | "fixed"; value: number } }[];
  pros: string[];
  status?: "active" | "prospect";
}) {
  const isProspect = opts.status === "prospect";
  const tenant = await prisma.tenant.create({
    data: {
      name: opts.name,
      slug: opts.slug,
      segment: opts.segment,
      status: opts.status ?? "active",
      planId: isProspect ? null : opts.planId,
      address: isProspect ? null : "Rua das Flores, 123 — São Paulo, SP",
      instagramHandle: opts.slug.replace(/-/g, ""),
      previewToken: isProspect ? randomToken(24) : null,
      previewExpiresAt: isProspect ? new Date(Date.now() + 14 * 86400_000) : null,
      reminderHours: [24, 2],
      units: { create: { name: "Principal" } },
    },
    include: { units: true },
  });
  if (!isProspect) {
    await prisma.user.create({
      data: { tenantId: tenant.id, name: `Dono ${opts.name}`, email: opts.ownerEmail, passwordHash: await hashPassword(PASSWORD), role: "owner" },
    });
  }
  await addMedia(tenant.id, "logo", demoPng(opts.colors[1], opts.colors[0], 160));
  await addMedia(tenant.id, "photo", demoPng(opts.colors[0], opts.colors[1]));
  await addMedia(tenant.id, "photo", demoPng(opts.colors[1], opts.colors[0]));

  const pros = [];
  for (const name of opts.pros) {
    const p = await prisma.professional.create({ data: { tenantId: tenant.id, unitId: tenant.units[0].id, displayName: name } });
    for (const wd of [1, 2, 3, 4, 5, 6]) {
      await prisma.workingHour.createMany({
        data: [
          { tenantId: tenant.id, professionalId: p.id, weekday: wd, startTime: "09:00", endTime: "12:00" },
          { tenantId: tenant.id, professionalId: p.id, weekday: wd, startTime: "13:00", endTime: wd === 6 ? "16:00" : "19:00" },
        ],
      });
    }
    pros.push(p);
  }
  for (const s of opts.services) {
    const svc = await prisma.service.create({
      data: {
        tenantId: tenant.id,
        name: s.name,
        description: isProspect ? "[exemplo] Serviço ilustrativo da prévia" : null,
        durationMinutes: s.minutes,
        bufferMinutes: s.buffer ?? 0,
        priceCents: s.cents,
        depositType: s.deposit?.type ?? "none",
        depositValue: s.deposit?.value ?? 0,
      },
    });
    for (const p of pros) await prisma.serviceProfessional.create({ data: { tenantId: tenant.id, serviceId: svc.id, professionalId: p.id } });
  }
  await brand(tenant.id, opts.name, opts.segment, isProspect ? "draft" : "published");
  return tenant;
}

/** Dados de demonstração da Fase 2 (idempotente: roda também sobre um seed antigo). */
async function ensurePhase2Demo() {
  if (!(await prisma.plan.findFirst({ where: { name: "Rede" } }))) {
    await prisma.plan.create({ data: { name: "Rede", priceCents: 29990, messageQuota: 3000, limitsJson: { professionals: 20, units: 5 } } });
  }
  await prisma.plan.updateMany({ where: { name: "Essencial" }, data: { limitsJson: { professionals: 1, units: 1 } } });
  await prisma.plan.updateMany({ where: { name: "Equipe" }, data: { limitsJson: { professionals: 5, units: 1 } } });
  const ana = await prisma.tenant.findUnique({ where: { slug: "studio-ana-nails" } });
  if (ana && !(await prisma.coupon.findFirst({ where: { tenantId: ana.id, code: "BEMVINDA10" } }))) {
    await prisma.coupon.create({ data: { tenantId: ana.id, code: "BEMVINDA10", discountType: "percent", discountValue: 10, maxPerCustomer: 1 } });
  }
  for (const t of await prisma.tenant.findMany({ where: { status: { in: ["active", "onboarding"] }, planId: { not: null } } })) {
    await startTrial(prisma, t.id, t.planId!);
  }
}

async function main() {
  if (await prisma.user.findUnique({ where: { email: "admin@amser.dev" } })) {
    await ensurePhase2Demo();
    console.log("Seed base já aplicado. Dados da Fase 2 garantidos (plano Rede, cupom BEMVINDA10, trials).");
    return;
  }
  const [basic, pro] = await Promise.all([
    prisma.plan.create({ data: { name: "Essencial", priceCents: 5990, messageQuota: 300, limitsJson: { professionals: 1, units: 1 } } }),
    prisma.plan.create({ data: { name: "Equipe", priceCents: 12990, messageQuota: 1000, limitsJson: { professionals: 5, units: 1 } } }),
  ]);
  await prisma.user.create({
    data: { name: "Superadmin", email: "admin@amser.dev", passwordHash: await hashPassword(PASSWORD), role: "superadmin" },
  });

  // Tenant A — nail designer, COM sinal obrigatório (pilar 2).
  await makeTenant({
    name: "Studio Ana Nails",
    slug: "studio-ana-nails",
    segment: "nail",
    ownerEmail: "ana@studioana.dev",
    planId: basic.id,
    colors: [[252, 231, 243], [190, 24, 93]],
    pros: ["Ana"],
    services: [
      { name: "Manicure", minutes: 45, cents: 4000, buffer: 10, deposit: { type: "percent", value: 30 } },
      { name: "Alongamento em gel", minutes: 120, cents: 16000, buffer: 15, deposit: { type: "percent", value: 30 } },
      { name: "Esmaltação em gel", minutes: 60, cents: 7000, buffer: 10, deposit: { type: "fixed", value: 2000 } },
    ],
  });

  // Tenant B — barbearia, SEM sinal (confirmação de presença pelo WhatsApp).
  await makeTenant({
    name: "Barbearia do João",
    slug: "barbearia-do-joao",
    segment: "barbearia",
    ownerEmail: "joao@barbearia.dev",
    planId: pro.id,
    colors: [[41, 37, 36], [180, 83, 9]],
    pros: ["João", "Pedro"],
    services: [
      { name: "Corte", minutes: 40, cents: 5000 },
      { name: "Barba", minutes: 30, cents: 4000 },
      { name: "Corte + barba", minutes: 60, cents: 8000, buffer: 5 },
    ],
  });

  // Prévia de prospect — sobrancelhas.
  const prospect = await makeTenant({
    name: "Bela Sobrancelhas",
    slug: "bela-sobrancelhas",
    segment: "sobrancelha",
    ownerEmail: "",
    planId: basic.id,
    colors: [[245, 237, 230], [124, 92, 74]],
    pros: ["Profissional (exemplo)"],
    services: [
      { name: "Design de sobrancelha", minutes: 30, cents: 4500 },
      { name: "Design com henna", minutes: 45, cents: 6000 },
    ],
    status: "prospect",
  });

  await ensurePhase2Demo();
  const app = process.env.APP_URL ?? "http://localhost:3000";
  console.log(`
Seed concluído. Senha de todos os usuários: ${PASSWORD}

  Superadmin ........ admin@amser.dev            → ${app}/admin
  Studio Ana Nails .. ana@studioana.dev  (sinal) → ${app}/studio-ana-nails
  Barbearia do João . joao@barbearia.dev         → ${app}/barbearia-do-joao
  Prévia prospect ... ${app}/preview/${prospect.previewToken}
`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
