export function BarSkeleton() {
  return (
    <div className="flex items-end gap-2 px-4 pb-2 pt-4" style={{ height: 252 }}>
      {[65, 40, 80, 55, 70, 45, 75, 50].map((h, i) => (
        <div key={i} className="flex-1 flex gap-0.5 items-end">
          <div className="flex-1 bg-muted animate-pulse rounded-t" style={{ height: `${h}%` }} />
          <div className="flex-1 bg-muted animate-pulse rounded-t" style={{ height: `${h * 0.65}%` }} />
        </div>
      ))}
    </div>
  )
}

export function DonutSkeleton() {
  return (
    <div className="flex flex-col items-center gap-4 py-6" style={{ minHeight: 340 }}>
      <div className="w-44 h-44 rounded-full border-[20px] border-border animate-pulse" />
      <div className="grid grid-cols-2 gap-2 px-6 w-full">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-4 bg-muted rounded animate-pulse" />
        ))}
      </div>
    </div>
  )
}

export function AdvancedSkeleton() {
  return (
    <div className="p-5 flex flex-col gap-2">
      <div className="h-2.5 w-28 bg-muted rounded animate-pulse mb-2" />
      {[...Array(5)].map((_, i) => (
        <div key={i} className="h-9 bg-muted rounded-xl animate-pulse" />
      ))}
    </div>
  )
}
