/**
 * Bootstrap de produção (idempotente, roda a cada deploy antes do servidor):
 *  - cria os planos, se não houver nenhum;
 *  - cria o superadmin a partir de ADMIN_EMAIL / ADMIN_PASSWORD, se ainda não existir nenhum.
 * NÃO cria dados de demonstração (isso é o `npm run db:seed`, só para dev).
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  if ((await prisma.plan.count()) === 0) {
    // Valores iniciais — ajuste no banco quando o preço final for decidido (Fase 0).
    await prisma.plan.createMany({
      data: [
        { name: "Essencial", priceCents: 5990, messageQuota: 300, limitsJson: { professionals: 1, units: 1 } },
        { name: "Equipe", priceCents: 12990, messageQuota: 1000, limitsJson: { professionals: 5, units: 1 } },
        { name: "Rede", priceCents: 29990, messageQuota: 3000, limitsJson: { professionals: 20, units: 5 } },
      ],
    });
    console.log("[bootstrap] planos criados");
  }

  const admins = await prisma.user.count({ where: { role: "superadmin" } });
  const email = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (admins === 0) {
    if (!email || password.length < 12) {
      console.warn("[bootstrap] Nenhum superadmin. Defina ADMIN_EMAIL e ADMIN_PASSWORD (12+ caracteres) e faça novo deploy.");
    } else {
      await prisma.user.create({
        data: { name: "Superadmin", email, passwordHash: await bcrypt.hash(password, 12), role: "superadmin" },
      });
      console.log(`[bootstrap] superadmin criado: ${email} — troque a senha em /conta e ative o MFA.`);
    }
  }
}

main()
  .catch((e) => {
    console.error("[bootstrap] falhou:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
