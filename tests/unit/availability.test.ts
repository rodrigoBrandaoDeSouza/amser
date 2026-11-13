import { describe, expect, it } from "vitest";
import { computeSlots } from "@/lib/scheduling/availability";
import { zonedToUtc, localDate, weekdayOf } from "@/lib/time";

const TZ = "America/Sao_Paulo";
const base = {
  timeZone: TZ,
  windows: [{ start: "09:00", end: "12:00" }],
  busy: [],
  durationMinutes: 60,
  bufferMinutes: 0,
  stepMinutes: 30,
  minAdvanceMinutes: 0,
  maxHorizonDays: 60,
};
const now = new Date("2026-11-10T08:00:00Z"); // 05:00 em SP

const hhmm = (d: Date) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(d);

describe("fuso horário", () => {
  it("converte horário de parede de SP (UTC-3) para UTC", () => {
    expect(zonedToUtc("2026-11-12", "09:00", TZ).toISOString()).toBe("2026-11-12T12:00:00.000Z");
  });
  it("data local e dia da semana", () => {
    expect(localDate(new Date("2026-11-13T02:30:00Z"), TZ)).toBe("2026-11-12");
    expect(weekdayOf("2026-11-12")).toBe(4); // quinta
  });
});

describe("computeSlots", () => {
  it("gera horários que cabem na janela", () => {
    const slots = computeSlots({ ...base, date: "2026-11-12", now });
    expect(slots.map(hhmm)).toEqual(["09:00", "09:30", "10:00", "10:30", "11:00"]);
  });

  it("remove horários que conflitam com agendamentos (incluindo buffer)", () => {
    const busy = [{ start: zonedToUtc("2026-11-12", "10:00", TZ), end: zonedToUtc("2026-11-12", "10:45", TZ) }];
    const slots = computeSlots({ ...base, date: "2026-11-12", now, busy, bufferMinutes: 15 });
    // 09:00 + 60 + 15 = 10:15 → conflita; 11:00 livre
    expect(slots.map(hhmm)).toEqual(["11:00"]);
  });

  it("respeita antecedência mínima", () => {
    const n = zonedToUtc("2026-11-12", "08:50", TZ);
    const slots = computeSlots({ ...base, date: "2026-11-12", now: n, minAdvanceMinutes: 60 });
    expect(slots.map(hhmm)).toEqual(["10:00", "10:30", "11:00"]);
  });

  it("não oferece datas passadas nem além do horizonte", () => {
    expect(computeSlots({ ...base, date: "2026-11-09", now })).toEqual([]);
    expect(computeSlots({ ...base, date: "2027-03-01", now, maxHorizonDays: 30 })).toEqual([]);
  });

  it("bloqueios de dia inteiro (feriado) zeram a agenda", () => {
    const busy = [{ start: zonedToUtc("2026-11-12", "00:00", TZ), end: zonedToUtc("2026-11-13", "00:00", TZ) }];
    expect(computeSlots({ ...base, date: "2026-11-12", now, busy })).toEqual([]);
  });

  it("várias janelas (pausa para almoço)", () => {
    const slots = computeSlots({
      ...base,
      date: "2026-11-12",
      now,
      windows: [
        { start: "09:00", end: "10:00" },
        { start: "13:00", end: "14:00" },
      ],
    });
    expect(slots.map(hhmm)).toEqual(["09:00", "13:00"]);
  });
});
