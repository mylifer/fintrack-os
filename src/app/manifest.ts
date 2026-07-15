import type { MetadataRoute } from 'next'

// PWA web app manifest — /manifest.webmanifest olarak servis edilir (Next dosya
// konvansiyonu, <link rel="manifest"> otomatik eklenir). Tarayıcı bu dosyayı
// cookie'siz çektiği için proxy.ts matcher'ında auth dışında tutulmuştur.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'FinTrack OS',
    short_name: 'FinTrack',
    description: 'Kişisel bütçe ve finans takip platformu',
    id: '/',
    start_url: '/dashboard',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#09090b',
    theme_color: '#09090b',
    lang: 'tr',
    categories: ['finance', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Tasarım full-bleed + içerik merkez %80'de → maskable olarak da güvenli
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
