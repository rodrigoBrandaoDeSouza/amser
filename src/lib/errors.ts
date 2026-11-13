/** Erro de domínio com mensagem segura para exibir ao usuário. */
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const Errors = {
  notFound: (what = "Recurso") => new AppError("not_found", `${what} não encontrado`, 404),
  forbidden: () => new AppError("forbidden", "Acesso negado", 403),
  unauthorized: () => new AppError("unauthorized", "Faça login para continuar", 401),
  slotTaken: () => new AppError("slot_taken", "Esse horário acabou de ser reservado. Escolha outro.", 409),
  slotUnavailable: () => new AppError("slot_unavailable", "Horário indisponível", 409),
  validation: (msg: string) => new AppError("validation", msg, 422),
  rateLimited: () => new AppError("rate_limited", "Muitas tentativas. Aguarde um pouco.", 429),
  policy: (msg: string) => new AppError("policy", msg, 409),
};

export function toHttp(err: unknown): { status: number; body: { error: string; message: string } } {
  if (err instanceof AppError) return { status: err.status, body: { error: err.code, message: err.message } };
  console.error("[erro inesperado]", err instanceof Error ? err.message : err);
  return { status: 500, body: { error: "internal", message: "Erro interno. Tente novamente." } };
}
