import { Header } from '@/components/layout/Header'
import { CategoryBoard } from '@/components/categories/board/CategoryBoard'

export default function CategoriesPage() {
  return (
    <>
      <Header title="Kategoriler" />
      <CategoryBoard />
    </>
  )
}
