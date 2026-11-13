/**
 * Teste de carga — "sábado de manhã" (§17, §20).
 *
 * Simula clientes simultâneos abrindo a página, consultando horários e
 * disputando os mesmos horários. Mede latência (p50/p95/p99) e confere no
 * banco que NENHUM horário foi reservado duas vezes.
 *
 * Uso (servidor rodando, seed aplicado):
 *   npx tsx scripts/load-test.ts --url http://localhost:3005 --slug barbearia-do-joao --clientes 60 --segundos 30
 */
import { PrismaClient } from "@prisma/client";

try {
  process.loadEnvFile(".env");
} catch {
  /* ok */
}

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : def;
};
const BASE = arg("url", "http://localhost:3005");
const SLUG = arg("slug", "barbearia-do-joao");
const CLIENTS = Number(arg("clientes", "60"));
const SECONDS = Number(arg("segundos", "30"));

const prisma = new PrismaClient();
const lat: Record<string, number[]> = { page: [], availability: [], booking: [] };
const status: Record<string, number> = {};
const count = (k: string) => (status[k] = (status[k] ?? 0) + 1);

async function timed(kind: string, fn: () => Promise<Response>) {
  const t = performance.now();
  try {
    const r = await fn();
    lat[kind].push(performance.now() - t);
    count(`${kind}:${r.status}`);
    return r;
  } catch (e) {
    count(`${kind}:erro-rede`);
    return null;
  }
}

function pct(arr: number[], p: number) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]);
}

async function main() {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: SLUG } });
  const services = await prisma.service.findMany({ where: { tenantId: tenant.id, active: true } });
  // Próximo sábado (no fuso da empresa ≈ UTC-3).
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7 || 7));
  const date = d.toISOString().slice(0, 10);
  const deadline = Date.now() + SECONDS * 1000;
  const before = await prisma.appointment.count({ where: { tenantId: tenant.id } });
  // Rate limit por IP do app: cada "cliente" usa um IP diferente (X-Forwarded-For).
  const ip = (i: number) => `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`;

  console.log(`Carga: ${CLIENTS} clientes por ${SECONDS}s em ${BASE}/${SLUG} (sábado ${date})`);

  let seq = 0;
  async function client(id: number) {
    while (Date.now() < deadline) {
      const h = { "x-forwarded-for": ip(id * 1000 + (seq++ % 1000)) };
      await timed("page", () => fetch(`${BASE}/${SLUG}`, { headers: h }));
      const svc = services[Math.floor(Math.random() * services.length)];
      const r = await timed("availability", () => fetch(`${BASE}/api/public/${SLUG}/availability?serviceId=${svc.id}&date=${date}`, { headers: h }));
      if (!r || !r.ok) continue;
      const { slots } = (await r.json()) as { slots: { startsAt: string }[] };
      if (!slots.length) continue;
      // Disputa: todos tendem aos primeiros horários.
      const pick = slots[Math.floor(Math.random() * Math.min(3, slots.length))];
      const phone = `119${String(60000000 + ((id * 7919 + seq) % 39999999)).padStart(8, "0")}`;
      await timed("booking", () =>
        fetch(`${BASE}/api/public/${SLUG}/appointments`, {
          method: "POST",
          headers: { ...h, "Content-Type": "application/json" },
          body: JSON.stringify({ serviceId: svc.id, professionalId: null, startsAt: pick.startsAt, customer: { name: `Carga ${id}`, phone, consentWhatsapp: false } }),
        }),
      );
    }
  }

  const t0 = Date.now();
  await Promise.all(Array.from({ length: CLIENTS }, (_, i) => client(i)));
  const elapsed = (Date.now() - t0) / 1000;

  const dupes = await prisma.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM appointments a JOIN appointments b
      ON a.professional_id = b.professional_id AND a.id < b.id
     AND a.status IN ('aguardando_sinal','pendente','confirmado')
     AND b.status IN ('aguardando_sinal','pendente','confirmado')
     AND tstzrange(a.starts_at, a.block_ends_at, '[)') && tstzrange(b.starts_at, b.block_ends_at, '[)')
    WHERE a.tenant_id = ${tenant.id}`;
  const created = (await prisma.appointment.count({ where: { tenantId: tenant.id } })) - before;
  const total = Object.values(lat).reduce((s, a) => s + a.length, 0);

  console.log(`\nRequisições: ${total} em ${elapsed.toFixed(1)}s (${(total / elapsed).toFixed(0)} req/s)`);
  for (const k of Object.keys(lat)) console.log(`${k.padEnd(13)} n=${String(lat[k].length).padStart(5)}  p50=${pct(lat[k], 50)}ms  p95=${pct(lat[k], 95)}ms  p99=${pct(lat[k], 99)}ms`);
  console.log("Status:", JSON.stringify(status));
  console.log(`Agendamentos criados: ${created}`);
  console.log(`Sobreposições no banco: ${dupes[0].n} ${Number(dupes[0].n) === 0 ? "✓" : "✗ FALHA"}`);
  const errors5xx = Object.entries(status).filter(([k]) => /:5\d\d|erro-rede/.test(k)).reduce((s, [, v]) => s + v, 0);
  console.log(`Erros 5xx/rede: ${errors5xx} ${errors5xx === 0 ? "✓" : "✗"}`);

  // Limpa os agendamentos de carga.
  await prisma.$executeRaw`DELETE FROM appointments WHERE tenant_id = ${tenant.id} AND customer_id IN (SELECT id FROM customers WHERE tenant_id = ${tenant.id} AND name LIKE 'Carga %')`;
  await prisma.$executeRaw`DELETE FROM customers WHERE tenant_id = ${tenant.id} AND name LIKE 'Carga %'`;
  await prisma.$disconnect();
  if (Number(dupes[0].n) > 0 || errors5xx > 0) process.exit(1);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
