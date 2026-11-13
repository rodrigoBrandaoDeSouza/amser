import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { peekAuthToken } from "@/lib/auth/tokens";
import { resetPassword } from "@/lib/auth/account";
import { AppError } from "@/lib/errors";
import { Button, Field, Flash, Input } from "@/components/ui";
import { flashParams, str, type SearchParams } from "@/lib/actions";

export const metadata: Metadata = { title: "Nova senha", robots: { index: false } };

async function reset(token: string, fd: FormData) {
  "use server";
  if (str(fd, "password") !== str(fd, "confirm")) redirect(`/redefinir-senha/${token}?erro=` + encodeURIComponent("As senhas não conferem"));
  try {
    await resetPassword(token, str(fd, "password"));
  } catch (e) {
    redirect(`/redefinir-senha/${token}?erro=` + encodeURIComponent(e instanceof AppError ? e.message : "Erro ao redefinir"));
  }
  redirect("/login?ok=" + encodeURIComponent("Senha alterada. Entre com a nova senha."));
}

export default async function ResetPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: SearchParams }) {
  const { token } = await params;
  const { erro } = await flashParams(searchParams);
  const valid = await peekAuthToken(token, "reset_password");
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4">
      <h1 className="mb-6 text-center text-xl font-semibold">Criar nova senha</h1>
      <Flash erro={erro ?? (valid ? undefined : "Link inválido ou expirado. Peça um novo em “Esqueci a senha”.")} />
      {valid && (
        <form action={reset.bind(null, token)} className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5">
          <Field label="Nova senha" hint="Mínimo de 10 caracteres"><Input name="password" type="password" minLength={10} autoComplete="new-password" required /></Field>
          <Field label="Repita a senha"><Input name="confirm" type="password" minLength={10} autoComplete="new-password" required /></Field>
          <Button type="submit" className="w-full">Salvar nova senha</Button>
        </form>
      )}
    </main>
  );
}
