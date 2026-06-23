import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import Script from 'next/script'
import './globals.css'
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ['latin'], variable: '--font-sans' })

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
    <html lang="tr" className={cn("h-full", geist.variable, "font-sans")} suppressHydrationWarning>
      <body className="min-h-full bg-background text-foreground antialiased">
        {/* Anti-FOUC: restore saved theme before first paint */}
        <Script
          id="theme-restore"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{ __html: `try{if(localStorage.getItem('fintrack-theme')==='dark')document.documentElement.classList.add('dark')}catch(e){}` }}
        />
        {children}
      </body>
    </html>
  )
}
