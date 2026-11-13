import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { requestPasswordReset } from "@/lib/auth/account";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { Button, Field, Flash, Input } from "@/components/ui";
import { flashParams, str, type SearchParams } from "@/lib/actions";

export const metadata: Metadata = { title: "Esqueci a senha", robots: { index: false } };

async function request(fd: FormData) {
  "use server";
  const ip = clientIp(await headers());
  if (rateLimit(`reset:${ip}`, 5, 60 * 60_000)) {
    await requestPasswordReset(str(fd, "email")).catch((e) => console.error("[reset]", e));
  }
  // Mesma resposta sempre: não revela se o e-mail tem conta.
  redirect("/esqueci-senha?ok=" + encodeURIComponent("Se houver uma conta com esse e-mail, enviamos um link para criar uma nova senha."));
}

export default async function ForgotPage({ searchParams }: { searchParams: SearchParams }) {
  const { ok } = await flashParams(searchParams);
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <h1 className="mb-6 text-center text-xl font-semibold">Esqueci a senha</h1>
      <Flash ok={ok} />
      <form action={request} className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5">
        <Field label="E-mail da conta"><Input name="email" type="email" autoComplete="email" required /></Field>
        <Button type="submit" className="w-full">Enviar link</Button>
        <a href="/login" className="block text-center text-sm text-zinc-600 hover:underline">Voltar ao login</a>
      </form>
    </main>
  );
}
