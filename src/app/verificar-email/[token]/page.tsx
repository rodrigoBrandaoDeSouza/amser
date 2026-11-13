import type { Metadata } from "next";
import Link from "next/link";
import { verifyEmail } from "@/lib/auth/account";

export const metadata: Metadata = { title: "Confirmar e-mail", robots: { index: false } };

export default async function VerifyEmailPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  let ok = true;
  try {
    await verifyEmail(token);
  } catch {
    ok = false;
  }
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 text-center">
      <h1 className="text-xl font-semibold">{ok ? "E-mail confirmado ✓" : "Link inválido ou expirado"}</h1>
      <p className="mt-2 text-sm text-zinc-600">{ok ? "Obrigado! Sua conta está protegida." : "Peça um novo link no painel."}</p>
      <Link href="/painel" className="mt-6 inline-flex justify-center rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white">Ir para o painel</Link>
    </main>
  );
}
