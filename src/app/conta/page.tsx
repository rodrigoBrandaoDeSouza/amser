import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { currentUser } from "@/lib/auth/session";
import { decryptJson } from "@/lib/crypto";
import { otpauthUrl } from "@/lib/auth/totp";
import { Badge, Button, Card, Field, Flash, Input, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { flashParams, type SearchParams } from "@/lib/actions";
import { beginMfaAction, changePasswordAction, confirmMfaAction, disableMfaAction, resendVerificationAction } from "./actions";

export const metadata: Metadata = { title: "Minha conta", robots: { index: false } };

export default async function AccountPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await currentUser();
  if (!user) redirect("/login");
  const { ok, erro, get } = await flashParams(searchParams);
  const settingUp = !user.mfaEnabledAt && !!user.mfaSecretEncrypted && get("mfa") === "configurar";
  const secret = settingUp ? decryptJson<{ secret: string }>(user.mfaSecretEncrypted!).secret : null;
  const qr = secret ? await QRCode.toDataURL(otpauthUrl(secret, user.email), { margin: 1, width: 200 }) : null;
  const back = user.role === "superadmin" ? "/admin" : "/painel";

  return (
    <main className="mx-auto max-w-3xl px-4 py-8">
      <PageHeader title="Minha conta" subtitle={user.email} actions={<Link href={back} className="text-sm hover:underline">← Voltar</Link>} />
      <Flash ok={ok} erro={erro} />
      <div className="grid gap-6 md:grid-cols-2">
        <Card title="E-mail" actions={user.emailVerifiedAt ? <Badge tone="green">confirmado</Badge> : <Badge tone="amber">não confirmado</Badge>}>
          {user.emailVerifiedAt ? (
            <p className="text-sm text-zinc-600">Confirmado em {user.emailVerifiedAt.toLocaleDateString("pt-BR")}.</p>
          ) : (
            <form action={resendVerificationAction} className="space-y-2">
              <p className="text-sm text-zinc-600">Confirme seu e-mail para conseguir recuperar a senha.</p>
              <Button variant="secondary" type="submit">Enviar link de confirmação</Button>
            </form>
          )}
        </Card>

        <Card title="Verificação em duas etapas" actions={user.mfaEnabledAt ? <Badge tone="green">ativa</Badge> : <Badge>desativada</Badge>}>
          {user.mfaEnabledAt ? (
            <form action={disableMfaAction} className="space-y-3">
              <p className="text-sm text-zinc-600">Ativa desde {user.mfaEnabledAt.toLocaleDateString("pt-BR")}. Para desativar, informe um código do app.</p>
              <Field label="Código"><Input name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} required /></Field>
              <SubmitButton variant="danger">Desativar</SubmitButton>
            </form>
          ) : settingUp && qr ? (
            <form action={confirmMfaAction} className="space-y-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qr} alt="QR code para o app autenticador" className="h-44 w-44 rounded border" />
              <p className="break-all text-xs text-zinc-500">Ou digite a chave: <code>{secret}</code></p>
              <Field label="Código de 6 dígitos"><Input name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} required /></Field>
              <SubmitButton>Ativar</SubmitButton>
            </form>
          ) : (
            <form action={beginMfaAction} className="space-y-2">
              <p className="text-sm text-zinc-600">Além da senha, pedimos um código do app autenticador (Google Authenticator, Authy…) ao entrar.</p>
              <Button type="submit">Configurar</Button>
            </form>
          )}
        </Card>

        <Card title="Trocar senha" className="md:col-span-2">
          <form action={changePasswordAction} className="grid gap-3 sm:grid-cols-3">
            <Field label="Senha atual"><Input name="current" type="password" autoComplete="current-password" required /></Field>
            <Field label="Nova senha" hint="Mín. 10 caracteres"><Input name="next" type="password" minLength={10} autoComplete="new-password" required /></Field>
            <Field label="Repita a nova senha"><Input name="confirm" type="password" minLength={10} autoComplete="new-password" required /></Field>
            <div className="sm:col-span-3"><SubmitButton>Trocar senha</SubmitButton></div>
          </form>
          <p className="mt-2 text-xs text-zinc-500">Ao trocar a senha, todas as sessões abertas são encerradas.</p>
        </Card>
      </div>
    </main>
  );
}
