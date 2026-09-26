'use client'

import Link from 'next/link'
import { Header } from '@/components/layout/Header'
import { CardCalendar } from '@/components/cards/CardCalendar'

export default function CardCalendarPage() {
  return (
    <>
      <Header title="Kart Takvimi" />
      <div className="p-4 sm:p-6 flex flex-col gap-4">
        <CardCalendar />
        <p className="text-[11px] text-muted-foreground">
          Buradaki son ödeme tarihleri <Link href="/payments" className="text-primary hover:underline">Ödeme Takibi</Link>&apos;nde ve
          bildirimlerde, kesim tarihleri hesap sayfasındaki ekstrede kullanılır.
        </p>
      </div>
    </>
  )
}
