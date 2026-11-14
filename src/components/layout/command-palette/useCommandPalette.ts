'use client'

import { create } from 'zustand'

/* Komut paletinin açık/kapalı durumu. Paylaşılan UI store'una (src/store)
   eklenmedi: yalnız layout bileşenleri (palet, kenar çubuğu, mobil "Diğer"
   sayfası) kullanıyor ve kalıcı olması gerekmiyor. */
interface CommandPaletteState {
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
}

export const useCommandPalette = create<CommandPaletteState>()(set => ({
  open: false,
  setOpen: open => set({ open }),
  toggle: () => set(s => ({ open: !s.open })),
}))

export const openCommandPalette = () => useCommandPalette.getState().setOpen(true)

/** Kısayol ipucu: Mac'te ⌘K, diğerlerinde Ctrl K. */
export function shortcutLabel(): string {
  if (typeof navigator === 'undefined') return 'Ctrl K'
  return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘K' : 'Ctrl K'
}
