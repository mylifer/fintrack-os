'use client'

type BadgeVariant = 'default' | 'ok' | 'warning' | 'danger' | 'info' | 'amber'

interface BadgeProps {
  children: React.ReactNode
  variant?: BadgeVariant
  className?: string
}

const variants: Record<BadgeVariant, string> = {
  default: 'bg-ground text-muted border-line',
  ok:      'bg-ok/10 text-ok border-ok/20',
  warning: 'bg-amber/10 text-amber border-amber/20',
  danger:  'bg-danger/10 text-danger border-danger/20',
  info:    'bg-info/10 text-info border-info/20',
  amber:   'bg-accent-light text-accent border-accent/30',
}

export function Badge({ children, variant = 'default', className = '' }: BadgeProps) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase border rounded-full ${variants[variant]} ${className}`}>
      {children}
    </span>
  )
}
