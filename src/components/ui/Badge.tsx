import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        /* ── shadcn standard ── */
        default:     "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:   "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive: "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 [a]:hover:bg-destructive/20",
        outline:     "border-border text-foreground [a]:hover:bg-secondary",
        ghost:       "hover:bg-secondary hover:text-foreground",
        link:        "text-primary underline-offset-4 hover:underline",
        /* ── semantic (financial statuses) ── */
        ok:      "bg-green-600/10      text-green-600      border-ok/20",
        warning: "bg-orange-500/10   text-orange-500   border-amber/20",
        danger:  "bg-destructive/10  text-destructive  border-danger/20",
        info:    "bg-blue-500/10    text-blue-500    border-info/20",
        amber:   "bg-orange-500/10   text-orange-500   border-amber/20",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
