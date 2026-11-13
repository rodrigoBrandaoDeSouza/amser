import type { Tenant } from "@prisma/client";
import type { Theme } from "@/lib/branding/theme";
import type { PublicService, PublicUnit } from "@/lib/public";
import { ThemeShell } from "./ThemeShell";
import { BookingFlow } from "./BookingFlow";
import { localDate } from "@/lib/time";

export function PublicPage({
  tenant,
  theme,
  services,
  policy,
  mode,
  logoMediaId,
  units = [],
}: {
  tenant: Tenant;
  theme: Theme;
  services: PublicService[];
  policy: string;
  mode: "live" | "preview";
  logoMediaId?: string | null;
  units?: PublicUnit[];
}) {
  const hero = theme.heroMediaId;
  const alt = (id: string) => theme.accessibility.altTexts[id] ?? `Foto de ${tenant.name}`;
  const whatsapp = tenant.whatsappContact?.replace(/\D/g, "");

  return (
    <ThemeShell theme={theme}>
      {mode === "preview" && (
        <div className="sticky top-0 z-20 bg-black px-4 py-2 text-center text-xs font-medium text-white">
          Prévia — serviços e preços de exemplo. Agendamento desativado.
        </div>
      )}

      <header className="relative">
        {hero ? (
          <div className="relative h-64 w-full overflow-hidden sm:h-80">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/media/${hero}`} alt={alt(hero)} className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
          </div>
        ) : (
          <div className="h-28 w-full" style={{ background: "var(--secondary)" }} />
        )}
        <div className="mx-auto -mt-12 max-w-2xl px-4">
          <div className="flex items-end gap-4">
            {logoMediaId && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/media/${logoMediaId}`}
                alt={`Logo de ${tenant.name}`}
                className="relative h-24 w-24 rounded-full border-4 object-cover"
                style={{ borderColor: "var(--bg)", background: "var(--bg)" }}
              />
            )}
          </div>
          <h1 className="mt-3 text-3xl font-bold leading-tight">{theme.copy.headline || tenant.name}</h1>
          {theme.copy.description && <p className="pub-muted mt-2 text-base">{theme.copy.description}</p>}
          <a href="#agendar" className="pub-btn mt-5 inline-flex px-6 py-3 text-base font-semibold">
            {theme.copy.cta}
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-4 pb-16" style={{ paddingTop: "var(--gap)" }}>
        <section id="agendar" className="scroll-mt-12 pt-8">
          <h2 className="mb-4 text-xl font-semibold">Agendar horário</h2>
          <BookingFlow
            slug={tenant.slug}
            services={services}
            policy={policy}
            disabled={mode === "preview"}
            today={localDate(new Date(), tenant.timezone)}
            timeZone={tenant.timezone}
            cardStyle={theme.elements.cardStyle}
            units={units}
            waitlistEnabled={tenant.waitlistEnabled && mode === "live"}
          />
        </section>

        {theme.galleryMediaIds.length > 0 && (
          <section className="pt-12">
            <h2 className="mb-4 text-xl font-semibold">Galeria</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {theme.galleryMediaIds.map((id) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={id} src={`/api/media/${id}`} alt={alt(id)} loading="lazy" className="aspect-square w-full object-cover" style={{ borderRadius: "var(--radius-card)" }} />
              ))}
            </div>
          </section>
        )}

        <section className="pt-12">
          <h2 className="mb-3 text-xl font-semibold">Contato</h2>
          <div className="pub-card space-y-1 p-4 text-sm" data-style={theme.elements.cardStyle}>
            {units.length > 1
              ? units.map((u) => (
                  <p key={u.id}>
                    <strong>{u.name}</strong>
                    {u.address ? ` — ${u.address}` : ""}
                    {u.phone ? ` · ${u.phone}` : ""}
                  </p>
                ))
              : (units[0]?.address ?? tenant.address) && <p>{units[0]?.address ?? tenant.address}</p>}
            {tenant.phone && <p>Telefone: {tenant.phone}</p>}
            <div className="flex flex-wrap gap-3 pt-2">
              {whatsapp && (
                <a className="underline" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noopener noreferrer">
                  WhatsApp
                </a>
              )}
              {tenant.instagramHandle && (
                <a className="underline" href={`https://instagram.com/${tenant.instagramHandle}`} target="_blank" rel="noopener noreferrer">
                  @{tenant.instagramHandle}
                </a>
              )}
            </div>
          </div>
        </section>
      </main>

      <footer className="pub-muted pb-8 text-center text-xs">
        Agendamento por <span className="font-semibold">Amser</span>
      </footer>
    </ThemeShell>
  );
}
