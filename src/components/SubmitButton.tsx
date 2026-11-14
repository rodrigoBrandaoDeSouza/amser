"use client";

import { useFormStatus } from "react-dom";
import { Button } from "./ui";
import type { ComponentProps } from "react";

/** Botão de envio que mostra spinner e texto de progresso enquanto a server action roda. */
export function SubmitButton({
  children,
  pendingText = "Salvando…",
  ...props
}: ComponentProps<typeof Button> & { pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" {...props} loading={pending}>
      {pending ? pendingText : children}
    </Button>
  );
}
