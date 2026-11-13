import { Card, Field, Flash, Input, PageHeader, Textarea } from "@/components/ui";
import { SegmentSelect } from "@/components/SegmentSelect";
import { SubmitButton } from "@/components/SubmitButton";
import { flashParams, type SearchParams } from "@/lib/actions";
import { createProspectAction } from "../../actions";

export default async function NewProspect({ searchParams }: { searchParams: SearchParams }) {
  const { ok, erro } = await flashParams(searchParams);
  return (
    <>
      <PageHeader
        title="Gerar prévia para prospect"
        subtitle="Peça 3 a 5 fotos e o logo pelo WhatsApp. Em poucos minutos o prospect vê a página dele pronta."
      />
      <Flash ok={ok} erro={erro} />
      <Card className="max-w-2xl">
        <form action={createProspectAction} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nome do negócio">
              <Input name="name" required minLength={2} maxLength={80} placeholder="Studio Ana Nails" />
            </Field>
            <Field label="Segmento">
              <SegmentSelect />
            </Field>
          </div>
          <Field label="Instagram (opcional)" hint="Só para referência e link na página. Não buscamos fotos do perfil.">
            <Input name="instagram" placeholder="@studioana" maxLength={40} />
          </Field>
          <Field label="Logo" hint="JPG, PNG ou WebP até 5 MB">
            <Input name="logo" type="file" accept="image/jpeg,image/png,image/webp" />
          </Field>
          <Field label="Fotos do espaço e dos trabalhos" hint="De 3 a 5 fotos funcionam melhor">
            <Input name="photos" type="file" accept="image/jpeg,image/png,image/webp" multiple required />
          </Field>
          <Field label="Preferências (opcional)" hint="Ex.: tons nude, estilo minimalista, público jovem">
            <Textarea name="preferences" rows={2} maxLength={300} />
          </Field>
          <label className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            <input type="checkbox" name="rights" required className="mt-0.5" />
            <span>
              Confirmo que o prospect <strong>enviou ou autorizou</strong> o uso destas imagens. Não usamos fotos copiadas do
              Instagram sem autorização.
            </span>
          </label>
          <p className="text-xs text-zinc-500">
            A prévia usa serviços e preços de exemplo, não é indexada e é apagada automaticamente em 14 dias.
          </p>
          <SubmitButton pendingText="Gerando prévia com IA…">Gerar prévia</SubmitButton>
        </form>
      </Card>
    </>
  );
}
