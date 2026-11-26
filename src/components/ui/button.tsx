import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"
import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        /* ── shadcn standard variants ── */
        default:
          "bg-primary text-primary-foreground hover:bg-primary/80",
        outline:
          "border-border bg-background hover:bg-secondary hover:text-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        ghost:
          "hover:bg-secondary hover:text-foreground",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20",
        link: "text-primary underline-offset-4 hover:underline",
        /* ── semantic aliases (backward compat) ── */
        primary:
          "bg-primary text-primary-foreground hover:bg-primary/80",
        danger:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20",
        ok:
          "bg-green-600/10 text-green-600 hover:bg-green-600/20",
        warning:
          "bg-orange-500/10 text-orange-500 hover:bg-orange-500/20",
      },
      size: {
        default: "h-9 px-4",
        xs:      "h-6 rounded-lg px-2 text-xs",
        sm:      "h-7 rounded-lg px-2.5 text-[0.8rem]",
        lg:      "h-10 px-4",
        icon:    "size-8",
        "icon-xs": "size-6 rounded-md",
        "icon-sm": "size-7 rounded-md",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?:    boolean
    fullWidth?:  boolean
    loading?:    boolean
    leftIcon?:   React.ReactNode
    rightIcon?:  React.ReactNode
  }

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  fullWidth = false,
  loading = false,
  leftIcon,
  rightIcon,
  children,
  disabled,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      disabled={disabled || loading}
      className={cn(buttonVariants({ variant, size }), fullWidth && "w-full", className)}
      {...props}
    >
      {loading
        ? <Loader2 className="size-4 animate-spin" />
        : leftIcon
      }
      {children}
      {!loading && rightIcon}
    </Comp>
  )
}

export { Button, buttonVariants }
