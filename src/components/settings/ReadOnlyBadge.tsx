/** Salt okuma (viewer, 0028) olarak paylaşılan alanın rozeti. */
export function ReadOnlyBadge() {
  return (
    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground" title="Bu alanı görebilirsiniz ama değiştiremezsiniz">
      Salt okuma
    </span>
  )
}
