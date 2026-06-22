import { Sidebar }      from '@/components/layout/Sidebar'
import { MobileNav }    from '@/components/layout/MobileNav'
import { QuickAddFAB }  from '@/components/layout/QuickAddFAB'
import { DataProvider } from '@/components/layout/DataProvider'
import { TransactionFormModal } from '@/components/transactions/TransactionFormModal'

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <DataProvider>
      <div className="flex min-h-screen bg-ground">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0 pb-20 lg:pb-0">
          {children}
        </div>
        <MobileNav />
        <QuickAddFAB />
        <TransactionFormModal />
      </div>
    </DataProvider>
  )
}
