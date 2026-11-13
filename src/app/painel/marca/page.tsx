import Link from "next/link";
import { requireTenantUser } from "@/lib/auth/session";
import { instagramProvider } from "@/lib/instagram/provider";
import { Badge, Button, Card, Field, Flash, Input, PageHeader, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { flashParams, type SearchParams } from "@/lib/actions";
import { FONTS, STYLES, ThemeSchema, defaultTheme } from "@/lib/branding/theme";
import { analyzeAction, deleteMediaAction, publishThemeAction, restoreThemeAction, saveThemeAction, uploadMediaAction } from "../actions";

export default async function BrandPage({ searchParams }: { searchParams: SearchParams }) {
  const { tenant, db } = await requireTenantUser();
  const { ok, erro, get } = await flashParams(searchParams);
  const [media, versions] = await Promise.all([
    db.tenantMedia.findMany({ orderBy: [{ kind: "asc" }, { createdAt: "asc" }] }),
    db.tenantBranding.findMany({ orderBy: { version: "desc" }, take: 15 }),
  ]);
  const current = versions[0];
  const parsed = current ? ThemeSchema.safeParse(current.themeJson) : null;
  const theme = parsed?.success ? parsed.data : defaultTheme(tenant.name);
  const device = get("device") === "desktop" ? "desktop" : "mobile";

  return (
    <>
      <PageHeader title="Marca" subtitle="A IA sugere, você revisa. Nada é publicado sem a sua aprovação." />
      <Flash ok={ok} erro={erro} />

      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <div className="space-y-6">
          <Card title="1. Imagens">
            <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
              {media.map((m) => (
                <figure key={m.id} className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/media/${m.id}`} alt="" className="aspect-square w-full rounded object-cover" />
                  <figcaption className="mt-0.5 flex items-center justify-between text-xs text-zinc-500">
                    {m.kind === "logo" ? "logo" : "foto"}
                    <form action={deleteMediaAction.bind(null, m.id)}><button className="text-red-600 hover:underline" aria-label="Remover imagem">remover</button></form>
                  </figcaption>
                </figure>
              ))}
              {!media.length && <p className="col-span-full text-sm text-zinc-500">Nenhuma imagem ainda.</p>}
            </div>
            <form action={uploadMediaAction} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Logo"><Input type="file" name="logo" accept="image/jpeg,image/png,image/webp" /></Field>
                <Field label="Fotos"><Input type="file" name="photos" accept="image/jpeg,image/png,image/webp" multiple /></Field>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="rights" required className="mt-0.5" />
                <span>As imagens são do meu negócio ou tenho autorização para usá-las.</span>
              </label>
              <SubmitButton variant="secondary" pendingText="Enviando…">Enviar imagens</SubmitButton>
            </form>
            {instagramProvider() && (
              <p className="mt-3 text-sm">
                Ou <Link href="/painel/marca/instagram" className="font-medium underline">importe fotos do seu Instagram</Link>.
              </p>
            )}
          </Card>

          <Card title="2. Gerar tema com IA">
            <form action={analyzeAction} className="space-y-3">
              <Field label="Preferências (opcional)" hint="Ex.: tons terrosos, visual minimalista">
                <Textarea name="preferences" rows={2} maxLength={300} />
              </Field>
              <SubmitButton disabled={!media.length} pendingText="Analisando suas imagens…">Gerar sugestão</SubmitButton>
            </form>
          </Card>

          <Card
            title={
              <span className="flex items-center gap-2">
                3. Ajustar {current && <>v{current.version} <Badge tone={current.status === "published" ? "green" : "blue"}>{current.status === "published" ? "publicado" : "rascunho"}</Badge></>}
              </span>
            }
          >
            <form action={saveThemeAction.bind(null, current?.id ?? "new")} className="space-y-4">
              <div className="grid grid-cols-5 gap-2">
                {(["primary", "secondary", "background", "text", "accent"] as const).map((k) => (
                  <label key={k} className="text-center text-xs text-zinc-600">
                    <input type="color" name={k} defaultValue={theme.colors[k]} className="h-10 w-full cursor-pointer rounded border" />
                    {{ primary: "Principal", secondary: "Secundária", background: "Fundo", text: "Texto", accent: "Destaque" }[k]}
                  </label>
                ))}
              </div>
              <p className="text-xs text-zinc-500">
                Contraste texto/fundo: {theme.accessibility.textOnBackground}:1 · botão: {theme.accessibility.onPrimary}:1 (mínimo 4.5:1 — corrigimos automaticamente).
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Fonte dos títulos">
                  <Select name="fontHeading" defaultValue={theme.fonts.heading}>{FONTS.map((f) => <option key={f}>{f}</option>)}</Select>
                </Field>
                <Field label="Fonte do texto">
                  <Select name="fontBody" defaultValue={theme.fonts.body}>{FONTS.map((f) => <option key={f}>{f}</option>)}</Select>
                </Field>
                <Field label="Estilo">
                  <Select name="style" defaultValue={theme.style}>{STYLES.map((s) => <option key={s}>{s}</option>)}</Select>
                </Field>
                <Field label="Cantos">
                  <Select name="radius" defaultValue={theme.elements.radius}>
                    <option value="none">Retos</option><option value="sm">Leves</option><option value="md">Médios</option><option value="lg">Arredondados</option><option value="full">Máximo</option>
                  </Select>
                </Field>
                <Field label="Botões">
                  <Select name="buttonStyle" defaultValue={theme.elements.buttonStyle}>
                    <option value="solid">Sólido</option><option value="pill">Pílula</option><option value="outline">Contorno</option>
                  </Select>
                </Field>
                <Field label="Cartões">
                  <Select name="cardStyle" defaultValue={theme.elements.cardStyle}>
                    <option value="border">Borda</option><option value="shadow">Sombra</option><option value="flat">Chapado</option>
                  </Select>
                </Field>
              </div>
              <Field label="Título"><Input name="headline" defaultValue={theme.copy.headline} maxLength={80} /></Field>
              <Field label="Descrição"><Textarea name="description" defaultValue={theme.copy.description} rows={3} maxLength={300} /></Field>
              <Field label="Texto do botão"><Input name="cta" defaultValue={theme.copy.cta} maxLength={30} /></Field>
              {media.some((m) => m.kind === "photo") && (
                <>
                  <Field label="Foto de capa">
                    <Select name="heroMediaId" defaultValue={theme.heroMediaId ?? ""}>
                      <option value="">Sem capa</option>
                      {media.filter((m) => m.kind === "photo").map((m, i) => <option key={m.id} value={m.id}>Foto {i + 1}</option>)}
                    </Select>
                  </Field>
                  <fieldset>
                    <legend className="mb-1 text-sm font-medium">Galeria</legend>
                    <div className="flex flex-wrap gap-3">
                      {media.filter((m) => m.kind === "photo").map((m, i) => (
                        <label key={m.id} className="flex items-center gap-1 text-sm">
                          <input type="checkbox" name="gallery" value={m.id} defaultChecked={theme.galleryMediaIds.includes(m.id)} /> Foto {i + 1}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </>
              )}
              <SubmitButton variant="secondary">Salvar rascunho</SubmitButton>
            </form>
          </Card>

          <Card title="Versões">
            <ul className="divide-y divide-zinc-100 text-sm">
              {versions.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-2 py-2">
                  <span className="font-medium">v{v.version}</span>
                  <Badge tone={v.status === "published" ? "green" : v.status === "draft" ? "blue" : "zinc"}>{v.status === "published" ? "publicado" : v.status === "draft" ? "rascunho" : "arquivado"}</Badge>
                  <span className="text-zinc-500">{v.createdAt.toLocaleString("pt-BR")}</span>
                  <span className="ml-auto flex gap-2">
                    {v.status !== "published" && <form action={publishThemeAction.bind(null, v.id)}><Button type="submit">Publicar</Button></form>}
                    {v.status === "archived" && <form action={restoreThemeAction.bind(null, v.id)}><Button variant="secondary" type="submit">Restaurar</Button></form>}
                  </span>
                </li>
              ))}
              {!versions.length && <li className="py-2 text-zinc-500">Nenhuma versão ainda.</li>}
            </ul>
          </Card>
        </div>

        <div className="xl:sticky xl:top-28 xl:self-start">
          <Card
            title="Prévia"
            actions={
              <div className="flex gap-1 text-xs">
                <a href="?device=mobile" className={`rounded px-2 py-1 ${device === "mobile" ? "bg-zinc-900 text-white" : "border"}`}>Celular</a>
                <a href="?device=desktop" className={`rounded px-2 py-1 ${device === "desktop" ? "bg-zinc-900 text-white" : "border"}`}>Computador</a>
              </div>
            }
          >
            {current ? (
              <div className="overflow-hidden rounded-lg border bg-zinc-100">
                <iframe
                  title="Prévia da página"
                  src={`/marca-preview/${current.id}`}
                  className={device === "mobile" ? "mx-auto h-[640px] w-[375px] max-w-full bg-white" : "h-[640px] w-full bg-white"}
                />
              </div>
            ) : (
              <p className="text-sm text-zinc-500">Gere ou salve um tema para ver a prévia.</p>
            )}
            {current?.status === "draft" && (
              <form action={publishThemeAction.bind(null, current.id)} className="mt-3">
                <Button type="submit" className="w-full">Aprovar e publicar este tema</Button>
              </form>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
