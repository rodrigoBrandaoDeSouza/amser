"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** Somente dev: simula o PSP confirmando o pagamento da fatura. */
export function DevPayInvoice() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs"
      onClick={async () => {
        setBusy(true);
        await fetch("/api/dev/simulate-billing", { method: "POST" });
        router.refresh();
        setBusy(false);
      }}
    >
      [dev] Simular pagamento da fatura
    </button>
  );
}
