import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-4 py-24">
      <p className="eyebrow mb-3 accent">404</p>
      <h1 className="display mb-4">Registro não encontrado</h1>
      <p className="text-sm text-muted">O endereço não existe ou o registro foi removido.</p>
      <Link href="/" className="btn btn-secondary mt-6">
        Voltar à dashboard
      </Link>
    </main>
  );
}
