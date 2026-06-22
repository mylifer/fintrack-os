import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import Script from 'next/script'
import './globals.css'

const inter = Inter({ variable: '--font-inter', subsets: ['latin'], display: 'swap' })

export const metadata: Metadata = {
  title: 'FinTrack OS',
  description: 'Kişisel bütçe ve finans takip platformu',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="tr" className={`h-full ${inter.variable}`} suppressHydrationWarning>
      <body className="min-h-full bg-ground text-ink antialiased">
        {/* Anti-FOUC: restore saved theme before first paint */}
        <Script
          id="theme-restore"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('fintrack-theme');if(t==='light')document.documentElement.setAttribute('data-theme','light')}catch(e){}` }}
        />
        {children}
      </body>
    </html>
  )
}
