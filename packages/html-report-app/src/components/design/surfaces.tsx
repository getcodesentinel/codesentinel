import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "../../lib/utils";

type SurfaceProps = {
  children: ReactNode;
  className?: string;
} & ComponentPropsWithoutRef<"div">;

export const SurfaceCard = ({ children, className, ...rest }: SurfaceProps) => (
  <div className={cn("ds-surface-card", className)} {...rest}>
    {children}
  </div>
);

export const SurfacePanel = ({ children, className, ...rest }: SurfaceProps) => (
  <div className={cn("ds-surface-panel", className)} {...rest}>
    {children}
  </div>
);

export const SurfaceInset = ({ children, className, ...rest }: SurfaceProps) => (
  <div className={cn("ds-surface-inset", className)} {...rest}>
    {children}
  </div>
);
