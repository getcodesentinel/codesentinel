import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.16em]",
  {
    variants: {
      variant: {
        default: "border-border bg-secondary text-secondary-foreground",
        success: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700",
        warning: "border-amber-500/20 bg-amber-500/10 text-amber-700",
        danger: "border-rose-500/20 bg-rose-500/10 text-rose-700",
        outline: "border-border/80 bg-transparent text-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export const Badge = ({
  className,
  variant,
  ...props
}: HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>) => (
  <div className={cn(badgeVariants({ variant }), className)} {...props} />
);
