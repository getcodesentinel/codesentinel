import type { ReactNode } from "react";
import { BodyMd, LabelSm } from "./typography";
import { cn } from "../../lib/utils";

type PageIntroProps = {
  label: string;
  title: string;
  description: ReactNode;
  aside?: ReactNode;
  className?: string;
  contentClassName?: string;
  labelClassName?: string;
};

export const PageIntro = ({
  label,
  title,
  description,
  aside,
  className,
  contentClassName,
  labelClassName,
}: PageIntroProps) => (
  <section
    className={cn("flex flex-col justify-between gap-6 md:flex-row md:items-end", className)}
  >
    <div className={cn("max-w-2xl", contentClassName)}>
      <LabelSm as="h3" className={cn("mb-1 tracking-[0.1em]", labelClassName)}>
        {label}
      </LabelSm>
      <h1 className="text-3xl font-semibold tracking-tight text-on-surface">{title}</h1>
      <BodyMd className="mt-2">{description}</BodyMd>
    </div>
    {aside === undefined ? null : <div className="flex gap-4">{aside}</div>}
  </section>
);
