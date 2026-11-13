/** Permissões configuráveis da equipe (§4). O dono tem todas. */
export const STAFF_PERMISSIONS = {
  manageBookings: "Criar, remarcar, cancelar e fechar agendamentos",
  viewAllAgendas: "Ver a agenda de todos os profissionais",
  viewCustomers: "Ver a lista de clientes",
  viewReports: "Ver relatórios",
} as const;

export type StaffPermission = keyof typeof STAFF_PERMISSIONS;

export const DEFAULT_STAFF_PERMISSIONS: Record<StaffPermission, boolean> = {
  manageBookings: true,
  viewAllAgendas: false,
  viewCustomers: false,
  viewReports: false,
};

export function staffPermissions(json: unknown): Record<StaffPermission, boolean> {
  const p = (json && typeof json === "object" ? json : {}) as Partial<Record<StaffPermission, unknown>>;
  const out = { ...DEFAULT_STAFF_PERMISSIONS };
  for (const k of Object.keys(DEFAULT_STAFF_PERMISSIONS) as StaffPermission[]) if (typeof p[k] === "boolean") out[k] = p[k] as boolean;
  return out;
}

export function can(user: { role: string; permissionsJson: unknown }, perm: StaffPermission): boolean {
  if (user.role === "owner") return true;
  if (user.role !== "staff") return false;
  return staffPermissions(user.permissionsJson)[perm];
}
