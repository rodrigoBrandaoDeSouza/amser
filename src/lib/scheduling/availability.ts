import { addDays, addMinutes, isValidTime, localDate, zonedToUtc } from "../time";

export interface Interval {
  start: Date;
  end: Date;
}

export interface SlotInput {
  /** Data local "YYYY-MM-DD" no fuso da unidade. */
  date: string;
  timeZone: string;
  /** Janelas de trabalho do dia (horário de parede "HH:MM"). */
  windows: { start: string; end: string }[];
  /** Intervalos ocupados: agendamentos ativos (até block_ends_at) e bloqueios. */
  busy: Interval[];
  durationMinutes: number;
  bufferMinutes: number;
  stepMinutes: number;
  now: Date;
  minAdvanceMinutes: number;
  maxHorizonDays: number;
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Calcula os horários de início disponíveis de UM profissional em um dia.
 * Regras:
 *  - o atendimento [início, início+duração) cabe inteiro numa janela de trabalho;
 *  - o bloqueio [início, início+duração+buffer) não sobrepõe nada ocupado;
 *  - respeita antecedência mínima e horizonte máximo.
 */
export function computeSlots(input: SlotInput): Date[] {
  const { date, timeZone, durationMinutes, bufferMinutes, stepMinutes, now } = input;
  if (durationMinutes <= 0 || stepMinutes <= 0) return [];

  const today = localDate(now, timeZone);
  if (date < today) return [];
  if (date > addDays(today, input.maxHorizonDays)) return [];

  const earliest = addMinutes(now, input.minAdvanceMinutes);
  const slots: Date[] = [];
  const seen = new Set<number>();

  for (const w of input.windows) {
    if (!isValidTime(w.start) || !isValidTime(w.end)) continue;
    const winStart = zonedToUtc(date, w.start, timeZone);
    const winEnd = zonedToUtc(date, w.end, timeZone);
    for (let t = winStart; addMinutes(t, durationMinutes) <= winEnd; t = addMinutes(t, stepMinutes)) {
      if (t < earliest) continue;
      const block: Interval = { start: t, end: addMinutes(t, durationMinutes + bufferMinutes) };
      if (input.busy.some((b) => overlaps(block, b))) continue;
      const key = t.getTime();
      if (!seen.has(key)) {
        seen.add(key);
        slots.push(t);
      }
    }
  }
  return slots.sort((a, b) => a.getTime() - b.getTime());
}

/** Limites UTC do dia local. */
export function dayBounds(date: string, timeZone: string): Interval {
  return { start: zonedToUtc(date, "00:00", timeZone), end: zonedToUtc(addDays(date, 1), "00:00", timeZone) };
}
