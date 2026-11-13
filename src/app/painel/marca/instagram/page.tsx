import { requireTenantUser } from "@/lib/auth/session";
import { Button, Card, Flash, LinkButton, PageHeader } from "@/components/ui";
import { SubmitButton } from "@/components/SubmitButton";
import { flashParams, type SearchParams } from "@/lib/actions";
import { instagramProvider } from "@/lib/instagram/provider";
import { listInstagramMedia, MAX_IMPORT } from "@/lib/instagram/service";
import { AppError } from "@/lib/errors";
import { disconnectInstagramAction, importInstagramAction } from "../../actions-fase2";

export default async function InstagramPage({ searchParams }: { searchParams: SearchParams }) {
  const { db } = await requireTenantUser();
  const { ok, erro, get } = await flashParams(searchParams);
  const provider = instagramProvider();
  const conn = await db.instagramConnection.findFirst({});

  let media: Awaited<ReturnType<typeof listInstagramMedia>> | null = null;
  let loadError: string | null = null;
  if (provider && conn) {
    try {
      media = await listInstagramMedia(conn.tenantId, get("depois") ?? null);
    } catch (e) {
      loadError = e instanceof AppError ? e.message : "Não foi possível carregar seus posts agora.";
    }
  }

  return (
    <>
      <PageHeader
        title="Importar do Instagram"
        subtitle="Conecte a conta profissional do seu negócio e escolha as fotos para a página. Só acessamos o seu próprio perfil, com a sua autorização."
        actions={<LinkButton href="/painel/marca">← Voltar para Marca</LinkButton>}
      />
      <Flash ok={ok} erro={erro ?? loadError ?? undefined} />
      {!provider ? (
        <Card><p className="text-sm text-zinc-600">A integração com o Instagram ainda não está disponível. Envie as fotos pelo upload em Marca.</p></Card>
      ) : !conn ? (
        <Card title="Conectar Instagram">
          <ul className="mb-4 list-disc space-y-1 pl-5 text-sm text-zinc-600">
            <li>Funciona com contas <strong>profissionais</strong> (Empresa ou Criador de conteúdo).</li>
            <li>Pedimos só a permissão básica: ver o perfil e as publicações.</li>
            <li>Você escolhe quais fotos importar; nada é publicado sem a sua aprovação.</li>
          </ul>
          <a href="/api/integrations/instagram/connect" className="inline-flex rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white">Conectar com o Instagram</a>
        </Card>
      ) : (
        <Card
          title={`@${conn.username}`}
          actions={<form action={disconnectInstagramAction}><Button variant="ghost" type="submit">Desconectar</Button></form>}
        >
          {media && (
            <form action={importInstagramAction} className="space-y-4">
              <p className="text-sm text-zinc-600">Selecione até {MAX_IMPORT} fotos. Vídeos não são importados.</p>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {media.items.map((m) => {
                  const thumb = m.type === "VIDEO" ? m.thumbnailUrl : m.mediaUrl;
                  const isMock = provider.name === "mock";
                  return (
                    <label key={m.id} className={`relative block ${m.type === "VIDEO" ? "opacity-40" : "cursor-pointer"}`}>
                      {thumb && !isMock ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumb} alt="" className="aspect-square w-full rounded object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <div className="flex aspect-square w-full items-center justify-center rounded bg-zinc-200 text-xs text-zinc-500">{m.type === "VIDEO" ? "vídeo" : `post ${m.id.slice(-2)}`}</div>
                      )}
                      {m.type !== "VIDEO" && <input type="checkbox" name="media" value={m.id} className="absolute left-2 top-2 h-5 w-5" aria-label="Importar esta foto" />}
                    </label>
                  );
                })}
              </div>
              <div className="flex items-center gap-3">
                <SubmitButton pendingText="Importando…">Importar selecionadas</SubmitButton>
                {media.after && <a className="text-sm underline" href={`?depois=${encodeURIComponent(media.after)}`}>Mais antigas →</a>}
              </div>
              <p className="text-xs text-zinc-500">Conexão válida até {conn.tokenExpiresAt.toLocaleDateString("pt-BR")} (renovada automaticamente).</p>
            </form>
          )}
        </Card>
      )}
    </>
  );
}
