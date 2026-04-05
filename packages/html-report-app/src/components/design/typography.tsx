import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import { cn } from "../../lib/utils";

type TextProps<T extends ElementType> = {
  as?: T;
  children: ReactNode;
  className?: string;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "children" | "className">;

const renderText = <T extends ElementType>(
  defaultTag: T,
  baseClassName: string,
  props: TextProps<T>,
) => {
  const { as, children, className, ...rest } = props;
  const Component = (as ?? defaultTag) as ElementType;

  return (
    <Component className={cn(baseClassName, className)} {...rest}>
      {children}
    </Component>
  );
};

export const LabelSm = <T extends ElementType = "span">(props: TextProps<T>) =>
  renderText("span" as T, "ds-label-sm", props);

export const HeadlineSm = <T extends ElementType = "h3">(props: TextProps<T>) =>
  renderText("h3" as T, "ds-headline-sm", props);

export const SectionHeading = <T extends ElementType = "h3">(props: TextProps<T>) =>
  renderText("h3" as T, "ds-section-heading", props);

export const TitleMd = <T extends ElementType = "h4">(props: TextProps<T>) =>
  renderText("h4" as T, "ds-title-md", props);

export const NavText = <T extends ElementType = "span">(props: TextProps<T>) =>
  renderText("span" as T, "ds-nav-text", props);

export const MetaLabel = <T extends ElementType = "span">(props: TextProps<T>) =>
  renderText("span" as T, "ds-meta-label", props);

export const BodyMd = <T extends ElementType = "p">(props: TextProps<T>) =>
  renderText("p" as T, "ds-body-md", props);

export const BodySm = <T extends ElementType = "p">(props: TextProps<T>) =>
  renderText("p" as T, "ds-body-sm", props);

export const MetricValue = <T extends ElementType = "span">(props: TextProps<T>) =>
  renderText("span" as T, "ds-metric-value", props);

export const MetricUnit = <T extends ElementType = "span">(props: TextProps<T>) =>
  renderText("span" as T, "ds-metric-unit", props);
