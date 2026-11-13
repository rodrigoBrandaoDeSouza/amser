"use server";

import type { DepositType, ExceptionType, MessageEvent } from "@prisma/client";
import { requireTenantUser } from "@/lib/auth/session";
import { runAction, str, int } from "@/lib/actions";
import { Errors } from "@/lib/errors";
import { parseBRL } from "@/lib/format";
import { isValidTime, zonedToUtc, isValidDate } from "@/lib/time";
import { audit } from "@/lib/audit";
import { encryptJson } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import { assertWithinPlan } from "@/lib/plans";
import { can } from "@/lib/auth/permissions";
import { createBooking, cancelAppointment, confirmPresence, markOutcome, rescheduleAppointment } from "@/lib/scheduling/booking";
import { uploadTenantImage, deleteTenantImage, createOwnerUser } from "@/lib/tenants";
import { analyzeBranding, publishBranding, restoreBranding, updateDraft, saveDraft, latestTheme } from "@/lib/branding/service";
import { FONTS, STYLES, ThemeSchema, normalizeEditedTheme, type Theme } from "@/lib/branding/theme";

// ---------------------------------------------------------------- agenda

/**
 * Staff: precisa da permissão "manageBookings" e, sem "viewAllAgendas", só
 * mexe nos agendamentos do próprio profissional.
 */
async function assertStaffMayManage(user: { role: string; permissionsJson: unknown }, tenantId: string, appointmentId: string | null, professionalId?: string) {
  if (user.role !== "staff") return;
  if (!can(user, "manageBookings")) throw Errors.forbidden();
  if (appointmentId && !can(user, "viewAllAgendas")) {
    const own = await prisma.appointment.findFirst({ where: { id: appointmentId, tenantId, professionalId: professionalId ?? "__none__" } });
    if (!own) throw Errors.forbidden();
  }
}

export async function appointmentAction(appointmentId: string, op: "concluido" | "nao_compareceu" | "cancelar" | "confirmar", back: string) {
  const { user, tenant, professional } = await requireTenantUser({ allowStaff: true });
  await runAction(back, async () => {
    await assertStaffMayManage(user, tenant.id, appointmentId, professional?.id);
    if (op === "cancelar") await cancelAppointment(tenant.id, appointmentId, { kind: "staff", userId: user.id }, "cancelado pela equipe");
    else if (op === "confirmar") await confirmPresence(tenant.id, appointmentId);
    else await markOutcome(tenant.id, appointmentId, op, user.id);
    await audit({ tenantId: tenant.id, actorId: user.id, action: `appointment.${op}`, resource: `appointment:${appointmentId}` });
    return "Agendamento atualizado";
  });
}

export async function rescheduleStaffAction(appointmentId: string, back: string, fd: FormData) {
  const { user, tenant, professional } = await requireTenantUser({ allowStaff: true });
  await runAction(back, async () => {
    await assertStaffMayManage(user, tenant.id, appointmentId, professional?.id);
    const date = str(fd, "date");
    const time = str(fd, "time");
    if (!isValidDate(date) || !isValidTime(time)) throw Errors.validation("Data/hora inválida");
    await rescheduleAppointment(tenant.id, appointmentId, zonedToUtc(date, time, tenant.timezone).toISOString(), { kind: "staff", userId: user.id });
    return "Remarcado";
  });
}

export async function manualBookingAction(fd: FormData) {
  const { user, tenant, professional } = await requireTenantUser({ allowStaff: true });
  const date = str(fd, "date");
  await runAction(`/painel/agenda?data=${date}`, async () => {
    await assertStaffMayManage(user, tenant.id, null);
    const time = str(fd, "time");
    if (!isValidDate(date) || !isValidTime(time)) throw Errors.validation("Data/hora inválida");
    // Staff sem "ver todas as agendas" só agenda para si.
    const proId = user.role === "staff" && !can(user, "viewAllAgendas") ? (professional?.id ?? "__none__") : str(fd, "professionalId") || null;
    await createBooking({
      tenant,
      serviceId: str(fd, "serviceId"),
      professionalId: proId,
      startsAt: zonedToUtc(date, time, tenant.timezone).toISOString(),
      customer: { name: str(fd, "name"), phone: str(fd, "phone"), email: null, consentWhatsapp: fd.get("consent") === "on" },
      source: "manual",
      actorId: user.id,
      skipDeposit: fd.get("skipDeposit") === "on",
    });
    return "Agendamento criado";
  });
}

export async function blockTimeAction(fd: FormData) {
  const { user, tenant, db, professional } = await requireTenantUser({ allowStaff: true });
  const date = str(fd, "date");
  await runAction(`/painel/agenda?data=${date}`, async () => {
    const start = str(fd, "start") || "00:00";
    const end = str(fd, "end") || "23:59";
    if (!isValidDate(date) || !isValidTime(start) || !isValidTime(end) || start >= end) throw Errors.validation("Período inválido");
    await assertStaffMayManage(user, tenant.id, null);
    const proId = user.role === "staff" && !can(user, "viewAllAgendas") ? (professional?.id ?? null) : str(fd, "professionalId") || null;
    if (!proId && user.role !== "owner") throw Errors.forbidden();
    await db.scheduleException.create({
      data: {
        tenantId: tenant.id,
        professionalId: proId,
        startsAt: zonedToUtc(date, start, tenant.timezone),
        endsAt: zonedToUtc(date, end, tenant.timezone),
        type: (str(fd, "type") || "block") as ExceptionType,
        reason: str(fd, "reason").slice(0, 120) || null,
      },
    });
    return "Bloqueio criado (agendamentos existentes não são afetados)";
  });
}

export async function deleteBlockAction(id: string, back: string) {
  const { db } = await requireTenantUser();
  await runAction(back, async () => {
    await db.scheduleException.deleteMany({ where: { id } });
    return "Bloqueio removido";
  });
}

// ---------------------------------------------------------------- serviços

export async function saveServiceAction(fd: FormData) {
  const { user, tenant, db } = await requireTenantUser();
  await runAction("/painel/servicos", async () => {
    const id = str(fd, "id");
    const name = str(fd, "name");
    if (name.length < 2) throw Errors.validation("Nome obrigatório");
    const price = parseBRL(str(fd, "price"));
    if (price === null) throw Errors.validation("Preço inválido");
    const duration = int(fd, "duration");
    if (duration < 5 || duration > 600) throw Errors.validation("Duração entre 5 e 600 minutos");
    const depositType = (["none", "percent", "fixed"].includes(str(fd, "depositType")) ? str(fd, "depositType") : "none") as DepositType;
    let depositValue = 0;
    if (depositType === "percent") depositValue = Math.min(100, Math.max(0, int(fd, "depositPercent", 30)));
    if (depositType === "fixed") depositValue = parseBRL(str(fd, "depositFixed")) ?? 0;

    let categoryId: string | null = null;
    const categoryName = str(fd, "category");
    if (categoryName) {
      const cat = (await db.serviceCategory.findFirst({ where: { name: categoryName } })) ??
        (await db.serviceCategory.create({ data: { tenantId: tenant.id, name: categoryName } }));
      categoryId = cat.id;
    }
    const data = {
      name,
      description: str(fd, "description").slice(0, 300) || null,
      durationMinutes: duration,
      bufferMinutes: Math.max(0, Math.min(120, int(fd, "buffer"))),
      priceCents: price,
      depositType,
      depositValue,
      active: fd.get("active") === "on",
      categoryId,
    };
    const svc = id
      ? await db.service.update({ where: { id }, data })
      : await db.service.create({ data: { ...data, tenantId: tenant.id } });

    const proIds = fd.getAll("professionals").map(String);
    const valid = await db.professional.findMany({ where: { id: { in: proIds } }, select: { id: true } });
    await db.serviceProfessional.deleteMany({ where: { serviceId: svc.id } });
    if (valid.length) {
      await db.serviceProfessional.createMany({ data: valid.map((p) => ({ tenantId: tenant.id, serviceId: svc.id, professionalId: p.id })) });
    }
    await audit({ tenantId: tenant.id, actorId: user.id, action: id ? "service.update" : "service.create", resource: `service:${svc.id}` });
    return "Serviço salvo";
  });
}

// ---------------------------------------------------------------- equipe

export async function saveProfessionalAction(fd: FormData) {
  const { tenant, db } = await requireTenantUser();
  await runAction("/painel/equipe", async () => {
    const id = str(fd, "id");
    const name = str(fd, "displayName");
    if (name.length < 2) throw Errors.validation("Nome obrigatório");
    // Unidade escolhida (Fase 2) ou a primeira ativa.
    const chosen = str(fd, "unitId") ? await db.unit.findFirst({ where: { id: str(fd, "unitId"), active: true } }) : null;
    const unit = chosen ?? (await db.unit.findFirstOrThrow({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }));
    const active = id ? fd.get("active") === "on" : true;
    // Limite do plano (Fase 2): conta profissionais ativos.
    const current = id ? await db.professional.findFirst({ where: { id } }) : null;
    if (active && !current?.active) await assertWithinPlan(tenant, "professionals");
    const pro = id
      ? await db.professional.update({ where: { id }, data: { displayName: name, active, ...(chosen ? { unitId: chosen.id } : {}) } })
      : await db.professional.create({ data: { tenantId: tenant.id, unitId: unit.id, displayName: name } });

    // Horários: até 2 janelas por dia da semana.
    const rows: { weekday: number; startTime: string; endTime: string }[] = [];
    for (let wd = 0; wd < 7; wd++) {
      for (const w of [1, 2]) {
        const s = str(fd, `d${wd}s${w}`);
        const e = str(fd, `d${wd}e${w}`);
        if (!s && !e) continue;
        if (!isValidTime(s) || !isValidTime(e) || s >= e) throw Errors.validation("Horário inválido na jornada");
        rows.push({ weekday: wd, startTime: s, endTime: e });
      }
    }
    if (fd.get("hoursSubmitted") === "1") {
      await db.workingHour.deleteMany({ where: { professionalId: pro.id } });
      if (rows.length) await db.workingHour.createMany({ data: rows.map((r) => ({ ...r, tenantId: tenant.id, professionalId: pro.id })) });
    } else if (!id) {
      // Novo profissional: jornada padrão seg–sáb 09–18.
      await db.workingHour.createMany({
        data: [1, 2, 3, 4, 5, 6].map((wd) => ({ tenantId: tenant.id, professionalId: pro.id, weekday: wd, startTime: "09:00", endTime: "18:00" })),
      });
    }
    return "Profissional salvo";
  });
}

export async function createStaffLoginAction(professionalId: string, fd: FormData) {
  const { user, tenant, db } = await requireTenantUser();
  await runAction("/painel/equipe", async () => {
    const pro = await db.professional.findFirst({ where: { id: professionalId } });
    if (!pro) throw Errors.notFound("Profissional");
    if (pro.userId) throw Errors.policy("Este profissional já tem acesso");
    const staff = await createOwnerUser(tenant.id, { name: pro.displayName, email: str(fd, "email"), password: str(fd, "password") }, "staff");
    await db.professional.update({ where: { id: pro.id }, data: { userId: staff.id } });
    await audit({ tenantId: tenant.id, actorId: user.id, action: "staff.create", resource: `user:${staff.id}` });
    return "Acesso criado. O profissional vê apenas a própria agenda.";
  });
}

// ---------------------------------------------------------------- marca

export async function uploadMediaAction(fd: FormData) {
  const { user, tenant } = await requireTenantUser();
  await runAction("/painel/marca", async () => {
    const rights = fd.get("rights") === "on";
    let n = 0;
    const logo = fd.get("logo");
    if (logo instanceof File && logo.size > 0) {
      await uploadTenantImage(tenant.id, { data: Buffer.from(await logo.arrayBuffer()), size: logo.size }, { kind: "logo", rightsConfirmed: rights, confirmedBy: `user:${user.id}` });
      n++;
    }
    for (const f of fd.getAll("photos")) {
      if (f instanceof File && f.size > 0) {
        await uploadTenantImage(tenant.id, { data: Buffer.from(await f.arrayBuffer()), size: f.size }, { kind: "photo", rightsConfirmed: rights, confirmedBy: `user:${user.id}` });
        n++;
      }
    }
    if (!n) throw Errors.validation("Selecione ao menos uma imagem");
    return `${n} imagem(ns) enviada(s)`;
  });
}

export async function deleteMediaAction(mediaId: string) {
  const { tenant } = await requireTenantUser();
  await runAction("/painel/marca", async () => {
    await deleteTenantImage(tenant.id, mediaId);
    return "Imagem removida";
  });
}

export async function analyzeAction(fd: FormData) {
  const { user, tenant } = await requireTenantUser();
  await runAction("/painel/marca", async () => {
    const started = Date.now();
    await analyzeBranding(tenant.id, { preferences: str(fd, "preferences") || null, actorId: user.id });
    return `Novo rascunho gerado em ${Math.round((Date.now() - started) / 1000)}s. Revise e publique.`;
  });
}

export async function saveThemeAction(brandingId: string, fd: FormData) {
  const { tenant, db } = await requireTenantUser();
  await runAction("/painel/marca", async () => {
    const current = await db.tenantBranding.findFirst({ where: { id: brandingId } });
    const base: Theme = current ? ThemeSchema.parse(current.themeJson) : await latestTheme(tenant.id, tenant.name);
    const pick = <T extends readonly string[]>(list: T, v: string, fallback: T[number]) => ((list as readonly string[]).includes(v) ? v : fallback) as T[number];
    const color = (k: keyof Theme["colors"]) => (/^#[0-9a-fA-F]{6}$/.test(str(fd, k)) ? str(fd, k) : base.colors[k]);
    const mediaIds = new Set((await db.tenantMedia.findMany({ select: { id: true } })).map((m) => m.id));
    const hero = str(fd, "heroMediaId");
    const next: Theme = normalizeEditedTheme({
      ...base,
      colors: { ...base.colors, primary: color("primary"), secondary: color("secondary"), background: color("background"), text: color("text"), accent: color("accent") },
      fonts: { heading: pick(FONTS, str(fd, "fontHeading"), base.fonts.heading), body: pick(FONTS, str(fd, "fontBody"), base.fonts.body) },
      style: pick(STYLES, str(fd, "style"), base.style),
      elements: {
        radius: pick(["none", "sm", "md", "lg", "full"] as const, str(fd, "radius"), base.elements.radius),
        buttonStyle: pick(["solid", "outline", "pill"] as const, str(fd, "buttonStyle"), base.elements.buttonStyle),
        cardStyle: pick(["flat", "shadow", "border"] as const, str(fd, "cardStyle"), base.elements.cardStyle),
        spacing: base.elements.spacing,
      },
      copy: { headline: str(fd, "headline"), description: str(fd, "description"), cta: str(fd, "cta") },
      heroMediaId: hero && mediaIds.has(hero) ? hero : null,
      galleryMediaIds: fd.getAll("gallery").map(String).filter((id) => mediaIds.has(id)).slice(0, 12),
    });
    if (current?.status === "draft") await updateDraft(tenant.id, current.id, next);
    else await saveDraft(tenant.id, next, { editedFrom: current?.version ?? null });
    return "Rascunho salvo. Confira a prévia e publique.";
  });
}

export async function publishThemeAction(brandingId: string) {
  const { user, tenant } = await requireTenantUser();
  await runAction("/painel/marca", async () => {
    await publishBranding(tenant.id, brandingId);
    await audit({ tenantId: tenant.id, actorId: user.id, action: "branding.publish", resource: `branding:${brandingId}` });
    return "Tema publicado na sua página";
  });
}

export async function restoreThemeAction(brandingId: string) {
  const { tenant } = await requireTenantUser();
  await runAction("/painel/marca", async () => {
    const d = await restoreBranding(tenant.id, brandingId);
    return `Versão restaurada como rascunho v${d.version}`;
  });
}

// ---------------------------------------------------------------- integrações

export async function saveWhatsappAction(fd: FormData) {
  const { user, tenant } = await requireTenantUser();
  await runAction("/painel/integracoes", async () => {
    const { saveAndTestConnection } = await import("@/lib/whatsapp/service");
    // Token nunca volta para o navegador; só é substituído se um novo for enviado.
    // A janela de envio é configurada em /painel/mensagens.
    const r = await saveAndTestConnection(tenant.id, user.id, {
      phoneNumberId: str(fd, "phoneNumberId"),
      wabaId: str(fd, "wabaId"),
      accessToken: str(fd, "accessToken") || null,
    });
    const name = r.info?.verifiedName ? ` (${r.info.verifiedName} · ${r.info.displayPhoneNumber})` : "";
    return r.subscribeWarning
      ? `Número validado${name}, mas não consegui inscrever o app na WABA: ${r.subscribeWarning}. Configure o webhook no painel da Meta.`
      : `WhatsApp conectado e validado na Meta${name}`;
  });
}

export async function provisionTemplatesAction() {
  const { user, tenant } = await requireTenantUser();
  await runAction("/painel/integracoes", async () => {
    const { provisionTemplates } = await import("@/lib/whatsapp/service");
    const r = await provisionTemplates(tenant.id, user.id);
    const errors = r.filter((x) => x.error);
    return errors.length
      ? `${r.length - errors.length} template(s) enviados para análise; ${errors.length} com erro: ${errors.map((e) => `${e.name} (${e.error})`).join("; ")}`
      : `${r.length} templates enviados para análise da Meta. A aprovação costuma levar de minutos a algumas horas.`;
  });
}

export async function syncTemplatesAction() {
  const { tenant } = await requireTenantUser();
  await runAction("/painel/integracoes", async () => {
    const { syncTemplates } = await import("@/lib/whatsapp/service");
    const n = await syncTemplates(tenant.id);
    return `Status de ${n} template(s) atualizado`;
  });
}

export async function saveTemplatesAction(fd: FormData) {
  const { tenant, db } = await requireTenantUser();
  await runAction("/painel/integracoes", async () => {
    const events: MessageEvent[] = ["booking_confirmed", "payment_pending", "reminder", "presence_request", "rescheduled", "cancelled", "waitlist_offer"];
    // Só o NOME do template (ligar/desligar fica em /painel/mensagens). Em branco = modelo padrão do Amser.
    const { definitionFor } = await import("@/lib/whatsapp/templates");
    for (const ev of events) {
      const name = str(fd, `tpl_${ev}`) || definitionFor(ev).name;
      if (!/^[a-z0-9_]{1,512}$/.test(name)) throw Errors.validation(`Nome de template inválido: ${name}`);
      const current = await db.messageTemplate.findFirst({ where: { eventType: ev } });
      if (current?.providerTemplateId === name) continue;
      await db.messageTemplate.upsert({
        where: { tenantId_eventType: { tenantId: tenant.id, eventType: ev } },
        create: { tenantId: tenant.id, eventType: ev, providerTemplateId: name },
        update: { providerTemplateId: name, status: "UNKNOWN", metaTemplateId: null },
      });
    }
    return "Nomes salvos. Clique em “Atualizar status” para conferir a aprovação na Meta.";
  });
}

// ---------------------------------------------------------------- configurações

export async function saveSettingsAction(fd: FormData) {
  const { user, tenant } = await requireTenantUser();
  await runAction("/painel/configuracoes", async () => {
    const clamp = (k: string, min: number, max: number, def: number) => Math.min(max, Math.max(min, int(fd, k, def)));
    // Lembretes, presença e lista de espera ficam em /painel/mensagens (saveMessagesAction).
    await prisma.tenant.update({
      where: { id: tenant.id },
      data: {
        description: str(fd, "description").slice(0, 300) || null,
        phone: str(fd, "phone") || null,
        whatsappContact: str(fd, "whatsappContact") || null,
        address: str(fd, "address").slice(0, 200) || null,
        instagramHandle: str(fd, "instagram").replace(/^@/, "") || null,
        minAdvanceMinutes: clamp("minAdvanceMinutes", 0, 10080, 60),
        maxHorizonDays: clamp("maxHorizonDays", 1, 365, 60),
        cancelLimitHours: clamp("cancelLimitHours", 0, 168, 24),
        holdMinutes: clamp("holdMinutes", 5, 120, 15),
        slotStepMinutes: [5, 10, 15, 20, 30, 60].includes(int(fd, "slotStepMinutes")) ? int(fd, "slotStepMinutes") : 15,
        cancellationPolicyText: str(fd, "cancellationPolicyText").slice(0, 600) || null,
      },
    });
    await audit({ tenantId: tenant.id, actorId: user.id, action: "settings.update", resource: `tenant:${tenant.id}` });
    return "Configurações salvas";
  });
}

/** Publicação da página: exige tema publicado, serviço e profissional com jornada. */
export async function publishPageAction() {
  const { user, tenant, db } = await requireTenantUser();
  await runAction("/painel", async () => {
    const [theme, services, hours] = await Promise.all([
      db.tenantBranding.count({ where: { status: "published" } }),
      db.service.count({ where: { active: true, professionals: { some: {} } } }),
      db.workingHour.count(),
    ]);
    if (!theme) throw Errors.policy("Publique um tema em Marca antes");
    if (!services) throw Errors.policy("Cadastre ao menos um serviço ativo com profissional");
    if (!hours) throw Errors.policy("Defina a jornada de ao menos um profissional");
    await prisma.tenant.update({ where: { id: tenant.id }, data: { status: "active" } });
    await audit({ tenantId: tenant.id, actorId: user.id, action: "page.publish", resource: `tenant:${tenant.id}` });
    return "Página publicada! Coloque o link na bio do Instagram.";
  });
}

export async function markRefundedAction(paymentId: string) {
  const { user, tenant, db } = await requireTenantUser();
  await runAction("/painel", async () => {
    const res = await db.payment.updateMany({ where: { id: paymentId, needsRefund: true }, data: { status: "refunded", refundedAt: new Date(), needsRefund: false } });
    if (!res.count) throw Errors.notFound("Pagamento");
    await audit({ tenantId: tenant.id, actorId: user.id, action: "payment.refunded", resource: `payment:${paymentId}` });
    return "Reembolso registrado";
  });
}

export async function testWhatsappAction(fd: FormData) {
  const { user, tenant } = await requireTenantUser();
  await runAction("/painel/integracoes", async () => {
    const { sendTestMessage } = await import("@/lib/whatsapp/service");
    const id = await sendTestMessage(tenant.id, user.id, str(fd, "testPhone"));
    return `Mensagem de teste enviada (id ${id.slice(0, 24)}…). Confira no WhatsApp do número informado.`;
  });
}
