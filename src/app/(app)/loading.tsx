export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="animate-pulse">
      <span className="sr-only">Carregando…</span>
      <div className="mb-3 h-3 w-28 rounded bg-cork/60" />
      <div className="mb-10 h-9 w-72 max-w-full rounded bg-cork/60" />
      <div className="grid grid-cols-1 gap-[18px] sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 rounded-[12px] border border-cork" />
        ))}
      </div>
      <div className="mt-[18px] h-72 rounded-[12px] border border-cork" />
    </div>
  );
}
