'use client'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8 text-center">
      <div className="text-4xl">⚠️</div>
      <h2 className="text-lg font-semibold text-foreground">Bir şeyler ters gitti</h2>
      <p className="text-sm text-muted-foreground max-w-xs">
        {error.message || 'Beklenmedik bir hata oluştu.'}
      </p>
      <button
        onClick={reset}
        className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Tekrar dene
      </button>
    </div>
  )
}
