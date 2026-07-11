import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import { headers } from 'next/headers'
import Script from 'next/script'
import './globals.css'
import { SpeedInsights } from '@vercel/speed-insights/next';
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' })

export const metadata: Metadata = {
  title: 'FinTrack OS',
  description: 'Kişisel bütçe ve finans takip platformu',
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  // Per-request CSP nonce set by proxy.ts on the x-nonce request header.
  // The inline theme <Script> below must carry it so it is allowed under
  // script-src 'self' 'nonce-...'. Reading headers() opts this tree into
  // dynamic rendering, which is required for nonce-based CSP.
  const nonce = (await headers()).get('x-nonce') ?? undefined

  return (
    <html lang="tr" className={cn("h-full", geist.variable, "font-sans")} suppressHydrationWarning>
      <body className="min-h-full bg-background text-foreground antialiased">
        {/* Anti-FOUC: restore saved theme before first paint */}
        <Script
          id="theme-restore"
          strategy="beforeInteractive"
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: `try{if(localStorage.getItem('fintrack-theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}` }}
        />
        {children}
        <SpeedInsights />
      </body>
    </html>
  )
}
