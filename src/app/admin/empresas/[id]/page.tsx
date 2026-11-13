import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { prisma } from "@/lib/db";
import { Badge, Button, Card, Field, Flash, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { formatBRL } from "@/lib/format";
import { SubmitButton } from "@/components/SubmitButton";
import { flashParams, type SearchParams } from "@/lib/actions";
import { env } from "@/lib/env";
import { ThemeSchema } from "@/lib/branding/theme";
import { allFlags } from "@/lib/flags";
import {
  cancelDeletionAction,
  enterSupportAction,
  scheduleDeletionAction,
  setFlagAction,
  changePlanAction,
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
  const tenantFlags = await allFlags(id);
  const [logs, sub, invoices, plans, domains] = await Promise.all([
    prisma.auditLog.findMany({ where: { tenantId: id }, orderBy: { createdAt: "desc" }, take: 15 }),
    prisma.subscription.findFirst({ where: { tenantId: id }, include: { plan: true }, orderBy: { periodEnd: "desc" } }),
    prisma.billingInvoice.findMany({ where: { tenantId: id }, orderBy: { dueAt: "desc" }, take: 6 }),
    prisma.plan.findMany({ orderBy: { priceCents: "asc" } }),
    prisma.tenantDomain.findMany({ where: { tenantId: id } }),
  ]);

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
          {!isProspect && (
            <Card title="Suporte e exclusão">
              <div className="space-y-3 text-sm">
                {tenant.supportAccessUntil && tenant.supportAccessUntil > new Date() ? (
                  <form action={enterSupportAction.bind(null, id)}>
                    <p className="mb-2 text-zinc-600">Dono autorizou acesso até {tenant.supportAccessUntil.toLocaleString("pt-BR")}.</p>
                    <Button type="submit">Entrar no painel (modo suporte)</Button>
                  </form>
                ) : (
                  <p className="text-zinc-600">Acesso de suporte não autorizado. O dono libera em Configurações → Acesso de suporte.</p>
                )}
                <div className="border-t border-zinc-100 pt-3">
                  {tenant.deletionScheduledAt ? (
                    <form action={cancelDeletionAction.bind(null, id)}>
                      <p className="mb-2 text-red-700">Exclusão definitiva em {tenant.deletionScheduledAt.toLocaleDateString("pt-BR")}.</p>
                      <Button variant="secondary" type="submit">Cancelar exclusão</Button>
                    </form>
                  ) : (
                    <form action={scheduleDeletionAction.bind(null, id)}>
                      <p className="mb-2 text-zinc-600">Suspende agora e apaga tudo (dados e fotos) em 30 dias.</p>
                      <Button variant="danger" type="submit">Programar exclusão</Button>
                    </form>
                  )}
                </div>
                <div className="border-t border-zinc-100 pt-3">
                  <p className="mb-2 font-medium">Flags desta empresa</p>
                  <ul className="space-y-1">
                    {tenantFlags.map((f) => (
                      <li key={f.key} className="flex items-center gap-2">
                        <span className="flex-1">{f.label}</span>
                        <span className="text-xs text-zinc-500">{f.enabled === null ? "global" : f.enabled ? "ligado" : "desligado"}</span>
                        <form action={setFlagAction.bind(null, f.key, id, f.enabled === false ? "default" : "off")}>
                          <button className="text-xs underline">{f.enabled === false ? "usar global" : "desligar aqui"}</button>
                        </form>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </Card>
          )}
          {!isProspect && (
            <Card title="Assinatura">
              {sub ? (
                <div className="space-y-1 text-sm">
                  <p>
                    {sub.plan.name} · {formatBRL(sub.plan.priceCents)}/mês · <Badge tone={sub.status === "active" ? "green" : sub.status === "past_due" ? "amber" : sub.status === "trialing" ? "blue" : "red"}>{sub.status}</Badge>
                  </p>
                  <p className="text-zinc-600">Período até {sub.periodEnd.toLocaleDateString("pt-BR")}{sub.graceUntil ? ` · tolerância até ${sub.graceUntil.toLocaleDateString("pt-BR")}` : ""}</p>
                  {tenant.suspendedReason && <p className="text-red-700">Suspensa por: {tenant.suspendedReason}</p>}
                  <ul className="mt-2 text-xs text-zinc-600">
                    {invoices.map((i) => (
                      <li key={i.id}>{i.dueAt.toLocaleDateString("pt-BR")} — {formatBRL(i.amountCents)} — {i.status}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="text-sm text-zinc-500">Sem assinatura.</p>
              )}
              <form action={changePlanAction.bind(null, id)} className="mt-3 flex gap-2">
                <Select name="planId" defaultValue={tenant.planId ?? undefined}>
                  {plans.map((p) => <option key={p.id} value={p.id}>{p.name} — {formatBRL(p.priceCents)}</option>)}
                </Select>
                <SubmitButton variant="secondary">Trocar plano</SubmitButton>
              </form>
              {domains.length > 0 && (
                <div className="mt-3 border-t border-zinc-100 pt-3 text-xs text-zinc-600">
                  Domínios: {domains.map((d) => `${d.hostname}${d.verifiedAt ? " ✓" : " (pendente)"}`).join(", ")}
                  <p className="mt-1">Domínio verificado precisa ser adicionado ao serviço no Railway para emitir o HTTPS.</p>
                </div>
              )}
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
