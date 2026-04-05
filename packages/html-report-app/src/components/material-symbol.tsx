import type { HTMLAttributes } from "react";

type MaterialSymbolProps = HTMLAttributes<HTMLSpanElement> & {
  icon: string;
};

export const MaterialSymbol = ({ icon, className, ...rest }: MaterialSymbolProps) => (
  <span
    className={["material-symbols-outlined", className].filter(Boolean).join(" ")}
    data-icon={icon}
    {...rest}
  >
    {icon}
  </span>
);
