import {
  type MouseEventHandler,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/utils";

type HoverTooltipTriggerProps = {
  onMouseEnter: MouseEventHandler<HTMLElement>;
  onMouseLeave: MouseEventHandler<HTMLElement>;
  onMouseMove: MouseEventHandler<HTMLElement>;
};

type UseHoverTooltipOptions = {
  offset?: number;
};

type HoverTooltipPortalProps = {
  content: ReactNode;
  visible: boolean;
  x: number;
  y: number;
  className?: string;
  offset?: number;
};

type TooltipState = {
  visible: boolean;
  x: number;
  y: number;
};

const VIEWPORT_PADDING = 12;

export const useHoverTooltip = ({ offset = 10 }: UseHoverTooltipOptions = {}) => {
  const [position, setPosition] = useState<TooltipState>({
    visible: false,
    x: 0,
    y: 0,
  });

  const updatePosition: MouseEventHandler<HTMLElement> = (event) => {
    setPosition({
      visible: true,
      x: event.clientX,
      y: event.clientY,
    });
  };

  const hideTooltip: MouseEventHandler<HTMLElement> = () => {
    setPosition((current) => ({ ...current, visible: false }));
  };

  const triggerProps: HoverTooltipTriggerProps = {
    onMouseEnter: updatePosition,
    onMouseMove: updatePosition,
    onMouseLeave: hideTooltip,
  };

  return {
    triggerProps,
    visible: position.visible,
    x: position.x,
    y: position.y,
    offset,
  };
};

export const HoverTooltipPortal = ({
  content,
  visible,
  x,
  y,
  className,
  offset = 10,
}: HoverTooltipPortalProps) => {
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const [mounted, setMounted] = useState(false);
  const [tooltipSize, setTooltipSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    if (!visible || tooltipRef.current === null) {
      return;
    }

    const rect = tooltipRef.current.getBoundingClientRect();
    setTooltipSize((current) =>
      current.width === rect.width && current.height === rect.height
        ? current
        : { width: rect.width, height: rect.height },
    );
  }, [content, visible]);

  const viewportWidth = typeof window === "undefined" ? 0 : window.innerWidth;
  const viewportHeight = typeof window === "undefined" ? 0 : window.innerHeight;
  const maxLeft = Math.max(VIEWPORT_PADDING, viewportWidth - tooltipSize.width - VIEWPORT_PADDING);
  const maxTop = Math.max(VIEWPORT_PADDING, viewportHeight - tooltipSize.height - VIEWPORT_PADDING);
  const left = Math.min(Math.max(VIEWPORT_PADDING, x - tooltipSize.width / 2), maxLeft);
  const top = Math.min(Math.max(VIEWPORT_PADDING, y - tooltipSize.height - offset), maxTop);

  if (!mounted || !visible) {
    return null;
  }

  return createPortal(
    <div
      className={cn(
        "pointer-events-none fixed z-50 rounded-md bg-on-surface px-2 py-1 text-[0.6875rem] text-surface shadow-lg",
        className,
      )}
      ref={tooltipRef}
      style={{ left, top }}
    >
      {content}
    </div>,
    document.body,
  );
};
