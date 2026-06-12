import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "../../lib/utils";

type Align = "left" | "center" | "right";

const stickyColumnClassName =
  "w-[clamp(9rem,30vw,17rem)] min-w-[clamp(9rem,30vw,17rem)] max-w-[clamp(9rem,30vw,17rem)] break-words [overflow-wrap:anywhere]";

const alignClassName = (align: Align): string => {
  if (align === "center") {
    return "text-center";
  }
  if (align === "right") {
    return "text-right";
  }
  return "text-left";
};

type ReportTableFrameProps = {
  children: ReactNode;
  className?: string;
  scrollClassName?: string;
} & ComponentPropsWithoutRef<"div">;

export const ReportTableFrame = ({
  children,
  className,
  scrollClassName,
  ...rest
}: ReportTableFrameProps) => (
  <div
    className={cn("overflow-hidden rounded-xl bg-surface-container-lowest shadow-xs", className)}
    {...rest}
  >
    <div className={cn("overflow-x-auto", scrollClassName)}>{children}</div>
  </div>
);

type ReportTableScrollProps = {
  children: ReactNode;
  className?: string;
} & ComponentPropsWithoutRef<"div">;

export const ReportTableScroll = ({ children, className, ...rest }: ReportTableScrollProps) => (
  <div className={cn("overflow-x-auto", className)} {...rest}>
    {children}
  </div>
);

type ReportTableProps = {
  children: ReactNode;
  className?: string;
} & ComponentPropsWithoutRef<"table">;

export const ReportTable = ({ children, className, ...rest }: ReportTableProps) => (
  <table className={cn("w-full text-left", className)} {...rest}>
    {children}
  </table>
);

type ReportTableRowProps = {
  children: ReactNode;
  className?: string;
  hover?: boolean;
} & ComponentPropsWithoutRef<"tr">;

export const ReportTableRow = ({
  children,
  className,
  hover = true,
  ...rest
}: ReportTableRowProps) => (
  <tr
    className={cn("group transition-colors", hover && "hover:bg-surface-container-low", className)}
    {...rest}
  >
    {children}
  </tr>
);

type ReportTableHeaderCellProps = {
  children: ReactNode;
  className?: string;
  align?: Align;
  sticky?: boolean;
} & ComponentPropsWithoutRef<"th">;

export const ReportTableHeaderCell = ({
  children,
  className,
  align = "left",
  sticky = false,
  ...rest
}: ReportTableHeaderCellProps) => (
  <th
    className={cn(
      "px-6 py-4 text-[0.6875rem] font-bold uppercase tracking-widest text-on-surface-variant",
      alignClassName(align),
      sticky && cn(stickyColumnClassName, "sticky left-0 z-20 bg-surface-container-low"),
      className,
    )}
    {...rest}
  >
    {children}
  </th>
);

type ReportTableCellProps = {
  children: ReactNode;
  className?: string;
  align?: Align;
  sticky?: boolean;
} & ComponentPropsWithoutRef<"td">;

export const ReportTableCell = ({
  children,
  className,
  align = "left",
  sticky = false,
  ...rest
}: ReportTableCellProps) => (
  <td
    className={cn(
      "px-6 py-4",
      alignClassName(align),
      sticky &&
        cn(
          stickyColumnClassName,
          "sticky left-0 z-10 bg-surface-container-lowest group-hover:bg-surface-container-low",
        ),
      className,
    )}
    {...rest}
  >
    {children}
  </td>
);
