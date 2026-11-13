import type { Metadata } from "next";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { verifyActionToken } from "@/lib/tokens";
import { tenantDb, prisma } from "@/lib/db";
import { publishedTheme } from "@/lib/branding/service";
import { ThemeShell } from "@/components/public/ThemeShell";
import { ManageAppointment } from "@/components/public/ManageAppointment";
import { cancellationPolicy } from "@/lib/public";
import { formatBRL } from "@/lib/format";
import { formatDateTime, localDate } from "@/lib/time";
import { isWithinCancelWindow } from "@/lib/scheduling/deposit";
import { env } from "@/lib/env";

export const metadata: Metadata = { title: "Seu agendamento", robots: { index: false, follow: false } };

export default async function AppointmentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const claims = await verifyActionToken(token);
  if (!claims) notFound();
  const tenant = await prisma.tenant.findUnique({ where: { id: claims.tid } });
  if (!tenant) notFound();
  const appt = await tenantDb(tenant.id).appointment.findFirst({
    where: { id: claims.aid },
    include: { service: true, professional: true, unit: true, payments: { orderBy: { createdAt: "desc" } } },
  });
  if (!appt) notFound();

  const theme = await publishedTheme(tenant.id, tenant.name);
  const pending = appt.payments.find((p) => p.status === "pending");
  const qr = pending?.pixCopyPaste ? await QRCode.toDataURL(pending.pixCopyPaste, { margin: 1, width: 240 }) : null;
  const tz = appt.unit.timezone;

  return (
    <ThemeShell theme={theme}>
      <main className="mx-auto max-w-lg px-4 py-10">
        <p className="pub-muted text-sm">{tenant.name}</p>
        <h1 className="mt-1 text-2xl font-bold">Seu agendamento</h1>
        <div className="pub-card mt-6 space-y-1 p-4" data-style={theme.elements.cardStyle}>
          <div className="text-lg font-semibold">{appt.service.name}</div>
          <div className="capitalize">{formatDateTime(appt.startsAt, tz)}</div>
          <div className="pub-muted text-sm">
            com {appt.professional.displayName} · {appt.service.durationMinutes} min · {formatBRL(appt.priceSnapshotCents)}
          </div>
          {tenant.address && <div className="pub-muted text-sm">{tenant.address}</div>}
        </div>
        <ManageAppointment
          token={token}
          slug={tenant.slug}
          serviceId={appt.serviceId}
          professionalId={appt.professionalId}
          status={appt.status}
          confirmedPresence={!!appt.confirmedPresenceAt}
          startsAt={appt.startsAt.toISOString()}
          endsAt={appt.endsAt.toISOString()}
          title={`${appt.service.name} — ${tenant.name}`}
          location={tenant.address ?? ""}
          canChange={isWithinCancelWindow(appt.startsAt, tenant.cancelLimitHours)}
          cancelLimitHours={tenant.cancelLimitHours}
          policy={cancellationPolicy(tenant)}
          pix={
            pending
              ? { amount: formatBRL(pending.amountCents), copyPaste: pending.pixCopyPaste ?? "", qrDataUrl: qr, expiresAt: pending.expiresAt.toISOString() }
              : null
          }
          depositPaid={appt.payments.some((p) => ["paid", "applied"].includes(p.status)) ? formatBRL(appt.depositAmountSnapshotCents) : null}
          today={localDate(new Date(), tz)}
          timeZone={tz}
          devSimulate={env().NODE_ENV !== "production" && env().PAYMENT_PROVIDER === "mock"}
        />
      </main>
    </ThemeShell>
  );
}
