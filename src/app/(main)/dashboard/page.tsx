'use client'

import { Header }             from '@/components/layout/Header'
import { PeriodTabs }         from '@/components/ui/PeriodTabs'
import { StatCards }          from '@/components/dashboard/StatCards'
import { CashflowChart }      from '@/components/dashboard/CashflowChart'
import { NetWorthChart }      from '@/components/dashboard/NetWorthChart'
import { BudgetOverview }     from '@/components/dashboard/BudgetOverview'
import { RecentTransactions } from '@/components/dashboard/RecentTransactions'
import { AccountsWidget }     from '@/components/dashboard/AccountsWidget'
import { DebtSummary }        from '@/components/dashboard/DebtSummary'
import { useUIStore }         from '@/store'

export default function DashboardPage() {
  const { openModal } = useUIStore()

  return (
    <>
      <Header
        title="Dashboard"
        action={{ label: 'İşlem Ekle', onClick: () => openModal('add-transaction') }}
      />

      <PeriodTabs />

      <div className="p-4 lg:p-6 flex flex-col gap-4">

        {/* 4 stat cards */}
        <StatCards />

        {/* Charts: cashflow bars + net worth trend */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <CashflowChart />
          <NetWorthChart />
        </div>

        {/* Budget + Recent transactions */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <BudgetOverview />
          <RecentTransactions />
        </div>

        {/* Accounts + Debt summary */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <AccountsWidget />
          <DebtSummary />
        </div>

      </div>
    </>
  )
}
