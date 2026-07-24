import { Header } from '@/components/layout/Header'
import { CategoryViewsShell } from '@/components/categories/variants/CategoryViewsShell'

export default function CategoriesPage() {
  return (
    <div className="flex flex-col h-full">
      <Header title="Kategoriler" />
      <div className="flex-1 overflow-hidden p-4 lg:p-6">
        <div className="h-full rounded-2xl border border-border bg-card overflow-hidden flex flex-col">
          <CategoryViewsShell />
        </div>
      </div>
    </div>
  )
}
