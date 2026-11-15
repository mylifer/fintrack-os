/**
 * Pencerenin dışına tıklanınca / Esc'ye basılınca kapanmak yerine kısa bir
 * yatay titreme oynatılır: "bu pencere yalnız X ile kapanır" geri bildirimi.
 * Web Animations API kullanılır; `transform` üzerinden çalıştığı için
 * Tailwind'in `translate` ile yaptığı ortalamayı bozmaz.
 */
export function shakeElement(el: HTMLElement | null) {
  if (!el || typeof el.animate !== 'function') return
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
  el.getAnimations?.().forEach(a => { if (a.id === 'dismiss-shake') a.cancel() })
  const anim = el.animate(
    [
      { transform: 'translateX(0)' },
      { transform: 'translateX(-6px)' },
      { transform: 'translateX(6px)' },
      { transform: 'translateX(-4px)' },
      { transform: 'translateX(4px)' },
      { transform: 'translateX(-2px)' },
      { transform: 'translateX(0)' },
    ],
    { duration: 320, easing: 'ease-in-out' },
  )
  anim.id = 'dismiss-shake'
}
