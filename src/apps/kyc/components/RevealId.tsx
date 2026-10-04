"use client";

import { useState, useTransition } from "react";
import { revealIdAction } from "@/apps/kyc/actions";

export function RevealId({ caseId, masked, canReveal }: { caseId: string; masked: string; canReveal: boolean }) {
  const [value, setValue] = useState<string>();
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-mono">{value ?? masked}</span>
      {canReveal && !value && (
        <button
          type="button"
          disabled={pending}
          className="text-xs text-blue-700 underline"
          onClick={() =>
            startTransition(async () => {
              const res = await revealIdAction(caseId);
              setValue(res.value);
              setError(res.error);
            })
          }
        >
          Reveal (audited)
        </button>
      )}
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}
