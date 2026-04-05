import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/utils";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
};

export const PrimaryButton = ({ className, children, ...rest }: ButtonProps) => (
  <button className={cn("ds-button-primary", className)} {...rest}>
    {children}
  </button>
);

export const IconButton = ({ className, children, ...rest }: ButtonProps) => (
  <button className={cn("ds-icon-button", className)} {...rest}>
    {children}
  </button>
);

export const QuietAction = ({ className, children, ...rest }: ButtonProps) => (
  <button className={cn("ds-quiet-action", className)} {...rest}>
    {children}
  </button>
);
