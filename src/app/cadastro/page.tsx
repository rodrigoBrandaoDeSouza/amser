import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { Card, Field, Flash, Input } from "@/components/ui";
import { SegmentSelect } from "@/components/SegmentSelect";
import { SubmitButton } from "@/components/SubmitButton";
import { flashParams, str, type SearchParams } from "@/lib/actions";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { selfSignup, uploadTenantImage } from "@/lib/tenants";
import { createSession } from "@/lib/auth/session";
import { sendVerificationEmail } from "@/lib/auth/account";
import { analyzeBranding } from "@/lib/branding/service";
import { AppError } from "@/lib/errors";
import { env } from "@/lib/env";
import { isEnabled } from "@/lib/flags";
import { TRIAL_DAYS } from "@/lib/billing/service";

export const metadata: Metadata = { title: "Criar conta", description: "Sua página de agendamento com a cara da sua marca em minutos." };

async function signup(fd: FormData) {
  "use server";
  if (str(fd, "website")) redirect("/cadastro?ok=1"); // honeypot contra bots
  const ip = clientIp(await headers());
  if (!rateLimit(`signup:${ip}`, 3, 60 * 60_000)) redirect("/cadastro?erro=" + encodeURIComponent("Muitas tentativas. Tente mais tarde."));
  if (fd.get("terms") !== "on") redirect("/cadastro?erro=" + encodeURIComponent("Aceite os termos para continuar"));

  let dest = "/painel/marca?ok=" + encodeURIComponent("Conta criada! Seu teste grátis começou.");
  try {
    const { tenant, user } = await selfSignup({
      businessName: str(fd, "businessName"),
      segment: str(fd, "segment") || "salao",
      ownerName: str(fd, "ownerName"),
      email: str(fd, "email"),
      password: str(fd, "password"),
      phone: str(fd, "phone") || null,
    });
    await createSession(user);
    await sendVerificationEmail(user).catch((e) => console.error("[cadastro] e-mail de verificação", e));
    // Fotos opcionais já no cadastro: a IA sugere o tema na hora (pilar 1).
    const photos = fd.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
    if (photos.length && fd.get("rights") === "on") {
      for (const f of photos.slice(0, 6)) {
        await uploadTenantImage(tenant.id, { data: Buffer.from(await f.arrayBuffer()), size: f.size }, { kind: "photo", rightsConfirmed: true, confirmedBy: `user:${user.id}` });
      }
      try {
        await analyzeBranding(tenant.id, { actorId: user.id });
        dest = "/painel/marca?ok=" + encodeURIComponent("Conta criada e tema sugerido pela IA! Revise e publique.");
      } catch {
        dest = "/painel/marca?ok=" + encodeURIComponent("Conta criada. Gere o tema com IA quando quiser.");
      }
    }
  } catch (e) {
    const msg = e instanceof AppError ? e.message : "Não foi possível criar a conta";
    if (!(e instanceof AppError)) console.error("[cadastro]", e);
    redirect("/cadastro?erro=" + encodeURIComponent(msg));
  }
  redirect(dest);
}

export default async function SignupPage({ searchParams }: { searchParams: SearchParams }) {
  const { erro } = await flashParams(searchParams);
  if (env().SELF_SIGNUP_ENABLED !== "true" || !(await isEnabled("self_signup"))) redirect("/login");
  return (
    <main className="mx-auto max-w-lg px-4 py-12">
      <Link href="/" className="text-xl font-bold tracking-tight">Amser</Link>
      <h1 className="mt-6 text-2xl font-semibold">Crie sua página de agendamento</h1>
      <p className="mt-1 text-sm text-zinc-600">{TRIAL_DAYS} dias grátis. Sem cartão. Sem comissão por cliente.</p>
      <div className="mt-6"><Flash erro={erro} /></div>
      <Card>
        <form action={signup} className="space-y-4">
          <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome do negócio"><Input name="businessName" required minLength={2} maxLength={80} /></Field>
            <Field label="Segmento"><SegmentSelect /></Field>
            <Field label="Seu nome"><Input name="ownerName" required autoComplete="name" /></Field>
            <Field label="WhatsApp"><Input name="phone" inputMode="tel" autoComplete="tel" /></Field>
          </div>
          <Field label="E-mail"><Input name="email" type="email" required autoComplete="email" /></Field>
          <Field label="Senha" hint="Mínimo de 10 caracteres"><Input name="password" type="password" minLength={10} required autoComplete="new-password" /></Field>
          <Field label="Fotos do seu trabalho (opcional)" hint="Mande 3 a 5 fotos e a IA monta sua página com a cara da sua marca">
            <Input name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple />
          </Field>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="rights" className="mt-0.5" /> As fotos são do meu negócio ou tenho autorização para usá-las.</label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="terms" required className="mt-0.5" /> Li e aceito os termos de uso e a política de privacidade.</label>
          <SubmitButton className="w-full" pendingText="Criando sua página…">Criar conta grátis</SubmitButton>
        </form>
      </Card>
      <p className="mt-4 text-center text-sm text-zinc-600">Já tem conta? <Link href="/login" className="underline">Entrar</Link></p>
    </main>
  );
}
