"use client";

import { RotateCcw } from "lucide-react";

export default function ErrorPage({ reset, error }: { reset: () => void; error: Error & { digest?: string } }) {
  return (
    <div className="max-w-xl">
      <p className="eyebrow mb-3 accent">Erro</p>
      <h1 className="display mb-4">Algo não saiu como esperado</h1>
      <p className="text-sm text-muted">
        A página não pôde ser carregada. Nenhum dado foi alterado. Tente novamente; se o problema persistir, informe o código abaixo ao
        responsável pelo sistema.
      </p>
      {error.digest ? <p className="mt-3 text-xs text-subtle">Código: {error.digest}</p> : null}
      <button type="button" onClick={reset} className="btn btn-secondary mt-6">
        <RotateCcw className="size-3.5" aria-hidden /> Tentar novamente
      </button>
    </div>
  );
}
