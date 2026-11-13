import { env } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { runAllJobs } from "@/lib/jobs";
import { json } from "@/lib/http";

/** Chamado pelo cron do Railway (ou `npm run jobs:run`). Protegido por segredo. */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!auth || !safeEqual(auth, env().JOBS_SECRET)) return json({ error: "unauthorized" }, { status: 401 });
  return json(await runAllJobs());
}
