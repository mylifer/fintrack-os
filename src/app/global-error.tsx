'use client'

import { useEffect } from 'react'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log the real error for debugging; never surface it to the user.
    console.error('Global application error:', error, error.digest ? `(digest: ${error.digest})` : '')
  }, [error])

  // global-error replaces the root layout, so it must render its own
  // <html>/<body> and cannot rely on the app's providers or global styles.
  // Styles are inlined to keep this fully self-contained.
  return (
    <html lang="tr">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          padding: '2rem',
          textAlign: 'center',
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          backgroundColor: '#ffffff',
          color: '#0a0a0a',
        }}
      >
        <title>Bir şeyler ters gitti</title>
        <div style={{ fontSize: '2.25rem' }}>⚠️</div>
        <h2 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0 }}>
          Bir şeyler ters gitti
        </h2>
        <p
          style={{
            fontSize: '0.875rem',
            color: '#6b7280',
            maxWidth: '20rem',
            margin: 0,
          }}
        >
          Beklenmedik bir hata oluştu. Lütfen tekrar deneyin.
        </p>
        <button
          onClick={() => reset()}
          style={{
            padding: '0.5rem 1rem',
            fontSize: '0.875rem',
            fontWeight: 500,
            borderRadius: '0.5rem',
            border: 'none',
            cursor: 'pointer',
            backgroundColor: '#0a0a0a',
            color: '#ffffff',
          }}
        >
          Tekrar dene
        </button>
      </body>
    </html>
  )
}
