import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { createSession, currentUser, destroySession, hashPassword, setPendingMfa, verifyPassword } from "@/lib/auth/session";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import { Button, Field, Flash, Input } from "@/components/ui";
import { flashParams, str, type SearchParams } from "@/lib/actions";

export const metadata: Metadata = { title: "Entrar", robots: { index: false } };

// Hash real (gerado uma vez) para igualar o tempo de resposta quando o e-mail não existe.
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword("amser-dummy-password"));

async function login(fd: FormData) {
  "use server";
  const email = str(fd, "email").toLowerCase();
  const password = str(fd, "password");
  const ip = clientIp(await headers());
  if (!rateLimit(`login:${ip}`, 10, 10 * 60_000) || !rateLimit(`login-email:${email}`, 5, 10 * 60_000)) {
    redirect("/login?erro=" + encodeURIComponent("Muitas tentativas. Aguarde alguns minutos."));
  }
  const user = await prisma.user.findUnique({ where: { email } });
  const ok = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !ok || user.status !== "active") {
    redirect("/login?erro=" + encodeURIComponent("E-mail ou senha inválidos"));
  }
  if (user.mfaEnabledAt) {
    // 2º passo: código do app autenticador.
    await setPendingMfa(user.id);
    redirect("/login/codigo");
  }
  await createSession(user);
  await audit({ tenantId: user.tenantId, actorId: user.id, action: "auth.login", resource: `user:${user.id}` });
  redirect(user.role === "superadmin" ? "/admin" : "/painel");
}

async function logout() {
  "use server";
  await destroySession();
  redirect("/login");
}

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const { ok, erro, get } = await flashParams(searchParams);
  const user = await currentUser();
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <div className="mb-8 text-center">
        <div className="text-2xl font-bold tracking-tight">Amser</div>
        <p className="mt-1 text-sm text-zinc-600">Acesse seu painel</p>
      </div>
      <Flash ok={ok} erro={erro ?? (get("erro") === "empresa-indisponivel" ? "Empresa indisponível" : undefined)} />
      {user ? (
        <form action={logout} className="space-y-3 text-center">
          <p className="text-sm">Você está conectado como {user.email}.</p>
          <a href={user.role === "superadmin" ? "/admin" : "/painel"} className="block rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white">
            Ir para o painel
          </a>
          <Button variant="ghost" type="submit">Sair</Button>
        </form>
      ) : (
        <form action={login} className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5">
          <Field label="E-mail">
            <Input name="email" type="email" autoComplete="email" required />
          </Field>
          <Field label="Senha">
            <Input name="password" type="password" autoComplete="current-password" required />
          </Field>
          <Button type="submit" className="w-full">Entrar</Button>
          <div className="flex justify-between text-sm">
            <a href="/esqueci-senha" className="text-zinc-600 hover:underline">Esqueci a senha</a>
            <a href="/cadastro" className="text-zinc-600 hover:underline">Criar conta</a>
          </div>
        </form>
      )}
    </main>
  );
}
