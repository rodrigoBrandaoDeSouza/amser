import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { prisma } from "@/lib/db";
import { Badge, Button, Card, Field, Flash, Input, PageHeader, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { flashParams, type SearchParams } from "@/lib/actions";
import { env } from "@/lib/env";
import { ThemeSchema } from "@/lib/branding/theme";
import {
  convertProspectAction,
  deleteProspectAction,
  extendPreviewAction,
  publishBrandingAdminAction,
  reanalyzeAction,
  setTenantStatusAction,
} from "../../actions";

export default async function TenantDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const { ok, erro } = await flashParams(searchParams);
  const tenant = await prisma.tenant.findUnique({
    where: { id },
    include: {
      plan: true,
      users: { select: { id: true, name: true, email: true, role: true, status: true } },
      media: { orderBy: { createdAt: "asc" } },
      branding: { orderBy: { version: "desc" }, take: 10 },
      _count: { select: { appointments: true, customers: true, services: true } },
    },
  });
  if (!tenant) notFound();
  const logs = await prisma.auditLog.findMany({ where: { tenantId: id }, orderBy: { createdAt: "desc" }, take: 15 });

  const isProspect = tenant.status === "prospect";
  const previewUrl = tenant.previewToken ? `${env().APP_URL}/preview/${tenant.previewToken}` : null;
  const publicUrl = `${env().APP_URL}/${tenant.slug}`;
  const qr = await QRCode.toDataURL(previewUrl ?? publicUrl, { margin: 1, width: 200 });

  return (
    <>
      <PageHeader
        title={tenant.name}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={isProspect ? "amber" : tenant.status === "active" ? "green" : tenant.status === "suspended" ? "red" : "blue"}>{tenant.status}</Badge>
            <span>/{tenant.slug}</span>
            <span>· {tenant.segment}</span>
            <span>· {tenant.plan?.name ?? "sem plano"}</span>
          </span>
        }
      />
      <Flash ok={ok} erro={erro} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {isProspect && previewUrl && (
            <Card title="Prévia para o prospect">
              <div className="flex flex-col gap-4 sm:flex-row">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={qr} alt="QR code da prévia" className="h-36 w-36 self-start rounded border" />
                <div className="min-w-0 space-y-2 text-sm">
                  <a href={previewUrl} target="_blank" className="block break-all font-medium text-blue-700 underline">{previewUrl}</a>
                  <p className="text-zinc-600">
                    Expira em {tenant.previewExpiresAt?.toLocaleDateString("pt-BR")}. Mídias e dados são apagados automaticamente depois.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <form action={extendPreviewAction.bind(null, id)}><Button variant="secondary" type="submit">Renovar por 14 dias</Button></form>
                    <form action={deleteProspectAction.bind(null, id)}><Button variant="danger" type="submit">Apagar prévia</Button></form>
                  </div>
                </div>
              </div>
              <hr className="my-5 border-zinc-200" />
              <h3 className="mb-3 text-sm font-semibold">Fechou? Converter em cliente</h3>
              <form action={convertProspectAction.bind(null, id)} className="grid gap-3 sm:grid-cols-3">
                <Field label="Nome do dono"><Input name="ownerName" required /></Field>
                <Field label="E-mail"><Input name="ownerEmail" type="email" required /></Field>
                <Field label="Senha inicial"><Input name="ownerPassword" type="password" minLength={10} required /></Field>
                <div className="sm:col-span-3"><SubmitButton>Converter (mantém tema e fotos)</SubmitButton></div>
              </form>
            </Card>
          )}

          <Card title="Identidade visual">
            <ul className="mb-4 divide-y divide-zinc-100 text-sm">
              {tenant.branding.map((b) => {
                const t = ThemeSchema.safeParse(b.themeJson);
                return (
                  <li key={b.id} className="flex flex-wrap items-center gap-3 py-2">
                    <span className="font-medium">v{b.version}</span>
                    <Badge tone={b.status === "published" ? "green" : b.status === "draft" ? "blue" : "zinc"}>{b.status}</Badge>
                    {t.success && (
                      <span className="flex gap-1">
                        {(["primary", "secondary", "background", "text", "accent"] as const).map((k) => (
                          <span key={k} title={k} className="h-5 w-5 rounded border" style={{ background: t.data.colors[k] }} />
                        ))}
                        <span className="ml-2 text-zinc-500">{t.data.fonts.heading} / {t.data.fonts.body} · {t.data.style}</span>
                      </span>
                    )}
                    {!isProspect && b.status !== "published" && (
                      <form action={publishBrandingAdminAction.bind(null, id, b.id)} className="ml-auto">
                        <Button variant="secondary" type="submit">Publicar</Button>
                      </form>
                    )}
                  </li>
                );
              })}
              {!tenant.branding.length && <li className="py-2 text-zinc-500">Nenhum tema gerado.</li>}
            </ul>
            <form action={reanalyzeAction.bind(null, id)} className="space-y-3 rounded-lg bg-zinc-50 p-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Adicionar logo"><Input name="logo" type="file" accept="image/jpeg,image/png,image/webp" /></Field>
                <Field label="Adicionar fotos"><Input name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple /></Field>
              </div>
              <Field label="Preferências"><Textarea name="preferences" rows={2} maxLength={300} /></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="rights" /> Imagens enviadas/autorizadas pelo negócio</label>
              <SubmitButton variant="secondary" pendingText="Analisando…">Gerar novo tema com IA</SubmitButton>
            </form>
          </Card>

          <Card title="Imagens">
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
              {tenant.media.map((m) => (
                <figure key={m.id} className="text-center text-xs text-zinc-500">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/media/${m.id}`} alt="" className="aspect-square w-full rounded object-cover" />
                  <figcaption>{m.kind}</figcaption>
                </figure>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-6">
          {!isProspect && (
            <Card title="Status">
              <div className="flex flex-wrap gap-2">
                {tenant.status !== "active" && <form action={setTenantStatusAction.bind(null, id, "active")}><Button type="submit">Ativar</Button></form>}
                {tenant.status !== "suspended" && <form action={setTenantStatusAction.bind(null, id, "suspended")}><Button variant="danger" type="submit">Suspender</Button></form>}
                {tenant.status === "suspended" && <form action={setTenantStatusAction.bind(null, id, "onboarding")}><Button variant="secondary" type="submit">Voltar p/ onboarding</Button></form>}
              </div>
              <a href={publicUrl} target="_blank" className="mt-3 block break-all text-sm text-blue-700 underline">{publicUrl}</a>
            </Card>
          )}
          <Card title="Números">
            <dl className="grid grid-cols-3 gap-2 text-center text-sm">
              <div><dt className="text-zinc-500">Serviços</dt><dd className="text-lg font-semibold">{tenant._count.services}</dd></div>
              <div><dt className="text-zinc-500">Clientes</dt><dd className="text-lg font-semibold">{tenant._count.customers}</dd></div>
              <div><dt className="text-zinc-500">Agend.</dt><dd className="text-lg font-semibold">{tenant._count.appointments}</dd></div>
            </dl>
          </Card>
          <Card title="Usuários">
            <ul className="space-y-1 text-sm">
              {tenant.users.map((u) => (
                <li key={u.id}>{u.name} <span className="text-zinc-500">· {u.email} · {u.role}</span></li>
              ))}
              {!tenant.users.length && <li className="text-zinc-500">Nenhum usuário.</li>}
            </ul>
          </Card>
          <Card title="Auditoria">
            <ul className="space-y-1 text-xs text-zinc-600">
              {logs.map((l) => (
                <li key={l.id}>{l.createdAt.toLocaleString("pt-BR")} — {l.action}</li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
