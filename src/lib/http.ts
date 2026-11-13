import { NextResponse } from "next/server";
import { toHttp, Errors } from "./errors";
import { clientIp, rateLimit } from "./rate-limit";

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, { ...init, headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) } });
}

export function errorResponse(err: unknown) {
  const { status, body } = toHttp(err);
  return json(body, { status });
}

export function limit(req: Request, bucket: string, max: number, windowMs: number) {
  if (!rateLimit(`${bucket}:${clientIp(req.headers)}`, max, windowMs)) throw Errors.rateLimited();
}
