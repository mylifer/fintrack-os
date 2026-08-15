import type { Metadata, Viewport } from 'next'
import { Geist } from 'next/font/google'
import { cookies, headers } from 'next/headers'
import Script from 'next/script'
import './globals.css'
import { SpeedInsights } from '@vercel/speed-insights/next';
import { cn } from "@/lib/utils";
import { ServiceWorkerRegistrar } from '@/components/pwa/ServiceWorkerRegistrar'
import { SidebarVariantProvider } from '@/components/layout/SidebarVariantProvider'
import { SIDEBAR_VARIANT_COOKIE, parseSidebarVariant } from '@/lib/sidebar-variant'

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' })

export const metadata: Metadata = {
  title: 'FinTrack OS',
  description: 'Kişisel bütçe ve finans takip platformu',
  applicationName: 'FinTrack OS',
  // iOS ana ekrana eklenince standalone (tarayıcı çubuğu olmadan) açılır
  appleWebApp: {
    capable: true,
    title: 'FinTrack OS',
    statusBarStyle: 'black-translucent',
  },
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#09090b' },
  ],
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

  // Kenar çubuğu görünümü çerezden okunur, böylece sunucu doğru varyantı basar;
  // istemcide düzeltme (ve görünür sıçrama) gerekmez.
  const sidebarVariant = parseSidebarVariant((await cookies()).get(SIDEBAR_VARIANT_COOKIE)?.value)

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
        <SidebarVariantProvider initial={sidebarVariant}>
          {children}
        </SidebarVariantProvider>
        <ServiceWorkerRegistrar />
        <SpeedInsights />
      </body>
    </html>
  )
}
