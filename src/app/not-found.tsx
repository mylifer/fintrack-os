import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8 text-center">
      <div className="text-4xl">404</div>
      <h2 className="text-lg font-semibold text-foreground">Sayfa bulunamadı</h2>
      <p className="text-sm text-muted-foreground">
        Aradığınız sayfa mevcut değil veya taşınmış olabilir.
      </p>
      <Link
        href="/dashboard"
        className="px-4 py-2 text-sm font-medium rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Ana sayfaya dön
      </Link>
    </div>
  )
}
