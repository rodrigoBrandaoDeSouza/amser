import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { clearPendingMfa, createSession, pendingMfaUser } from "@/lib/auth/session";
import { checkMfaCode } from "@/lib/auth/account";
import { rateLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import { Button, Field, Flash, Input } from "@/components/ui";
import { flashParams, str, type SearchParams } from "@/lib/actions";

export const metadata: Metadata = { title: "Código de verificação", robots: { index: false } };

async function verify(fd: FormData) {
  "use server";
  const user = await pendingMfaUser();
  if (!user) redirect("/login?erro=" + encodeURIComponent("Sessão expirada. Entre de novo."));
  if (!rateLimit(`mfa:${user.id}`, 5, 10 * 60_000)) redirect("/login/codigo?erro=" + encodeURIComponent("Muitas tentativas. Aguarde alguns minutos."));
  if (!checkMfaCode(user, str(fd, "code"))) {
    await audit({ tenantId: user.tenantId, actorId: user.id, action: "auth.mfa_failed", resource: `user:${user.id}` });
    redirect("/login/codigo?erro=" + encodeURIComponent("Código incorreto"));
  }
  await clearPendingMfa();
  await createSession(user);
  await audit({ tenantId: user.tenantId, actorId: user.id, action: "auth.login", resource: `user:${user.id}`, meta: { mfa: true } });
  redirect(user.role === "superadmin" ? "/admin" : "/painel");
}

export default async function MfaPage({ searchParams }: { searchParams: SearchParams }) {
  const { erro } = await flashParams(searchParams);
  if (!(await pendingMfaUser())) redirect("/login");
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <h1 className="mb-2 text-center text-xl font-semibold">Verificação em duas etapas</h1>
      <p className="mb-6 text-center text-sm text-zinc-600">Digite o código de 6 dígitos do seu app autenticador.</p>
      <Flash erro={erro} />
      <form action={verify} className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5">
        <Field label="Código">
          <Input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus className="text-center text-lg tracking-widest" />
        </Field>
        <Button type="submit" className="w-full">Entrar</Button>
      </form>
    </main>
  );
}
