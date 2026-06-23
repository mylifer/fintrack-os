'use client'

interface EmptyStateProps {
  icon?: string
  title: string
  description?: string
  action?: React.ReactNode
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      {icon && <span className="text-3xl mb-4 opacity-40">{icon}</span>}
      <p className="text-sm font-medium text-foreground mb-1">{title}</p>
      {description && <p className="text-xs text-muted-foreground mb-4 max-w-xs">{description}</p>}
      {action}
    </div>
  )
}
