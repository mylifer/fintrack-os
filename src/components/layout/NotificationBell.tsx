'use client'

import { useEffect, useRef, useState } from 'react'
import { IconBell } from '@tabler/icons-react'
import {
  useNotifications, getActionableCount, useNotificationsStore,
  hasUnseenBudgetAlert, currentBudgetAlertKeys,
} from '@/store/notifications.store'
import { NotificationPanel } from './NotificationPanel'

/* Zil ikonu + aksiyon bekleyen bildirim sayacı. Header'ın sağ aksiyon alanına
   mount edilir — Header her sayfada olduğundan tek noktadan tüm sayfalarda
   görünür. Rozet rengi Sidebar'daki dueCount pill'iyle tutarlı (turuncu). */

export function NotificationBell() {
  const [open, setOpen] = useState(false)
  const notifications = useNotifications()
  const count = getActionableCount(notifications)
  const markSeen = useNotificationsStore(s => s.markSeen)
  // Bütçe uyarıları sayaca girmez; yalnız yeni bir uyarı görülene kadar nokta
  const seenBudgetAlerts = useNotificationsStore(s => s.seenBudgetAlerts)
  const budgetDot = count === 0 && hasUnseenBudgetAlert(notifications, seenBudgetAlerts)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Dışarı tıklayınca kapan (panel + zil alanı hariç)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setOpen(o => !o)
          if (!open) markSeen(currentBudgetAlertKeys(notifications))
        }}
        className="relative w-11 h-11 lg:w-9 lg:h-9 rounded-xl flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        title="Bildirimler"
        aria-label={
          count > 0 ? `Bildirimler — ${count} onay bekleyen`
          : budgetDot ? 'Bildirimler — yeni bütçe uyarısı'
          : 'Bildirimler'
        }
        aria-expanded={open}
      >
        <IconBell size={20} stroke={1.75} />
        {budgetDot && (
          <span className="absolute top-1.5 right-1.5 lg:top-1 lg:right-1 w-2.5 h-2.5 rounded-full bg-destructive border-2 border-background" />
        )}
        {count > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-orange-500 text-white text-[10px] font-bold flex items-center justify-center leading-none border-2 border-background">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
      {open && <NotificationPanel notifications={notifications} onClose={() => setOpen(false)} />}
    </div>
  )
}
