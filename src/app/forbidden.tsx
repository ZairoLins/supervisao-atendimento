import Link from "next/link";

export default function Forbidden() {
  return (
    <main className="mx-auto max-w-xl px-4 py-24">
      <p className="eyebrow mb-3 accent">403</p>
      <h1 className="display mb-4">Acesso não autorizado</h1>
      <p className="text-sm text-muted">Seu perfil não tem permissão para acessar este conteúdo.</p>
      <Link href="/" className="btn btn-secondary mt-6">
        Voltar à dashboard
      </Link>
    </main>
  );
}
