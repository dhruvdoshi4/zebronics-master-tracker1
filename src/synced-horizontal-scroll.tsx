import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "./utils";

type DualHorizontalScrollProps = {
  children: ReactNode;
  /** Classes on the scrollable body (table area). */
  bodyClassName?: string;
  /** Minimum width hint for the top scrollbar track before table is measured. */
  minTrackWidthPx?: number;
};

/** Top + body horizontal scrollbars kept in sync — scroll sideways without reaching the page bottom. */
export function DualHorizontalScroll({
  children,
  bodyClassName,
  minTrackWidthPx = 1280,
}: DualHorizontalScrollProps) {
  const topRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const spacerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const syncing = useRef(false);

  useEffect(() => {
    const table = contentRef.current?.querySelector("table");
    const spacer = spacerRef.current;
    if (!table || !spacer) return;

    const applyWidth = () => {
      spacer.style.width = `${Math.max(table.scrollWidth, minTrackWidthPx)}px`;
    };

    applyWidth();
    const observer = new ResizeObserver(applyWidth);
    observer.observe(table);
    return () => observer.disconnect();
  }, [children, minTrackWidthPx]);

  const onScroll = (source: "top" | "body") => () => {
    if (syncing.current) return;
    syncing.current = true;
    const top = topRef.current;
    const body = bodyRef.current;
    if (top && body) {
      if (source === "top") body.scrollLeft = top.scrollLeft;
      else top.scrollLeft = body.scrollLeft;
    }
    requestAnimationFrame(() => {
      syncing.current = false;
    });
  };

  return (
    <>
      <div
        ref={topRef}
        onScroll={onScroll("top")}
        className="overflow-x-auto overflow-y-hidden border-b border-zinc-200 bg-zinc-100"
        aria-label="Scroll table horizontally"
      >
        <div ref={spacerRef} className="h-4" style={{ minWidth: minTrackWidthPx }} />
      </div>
      <div
        ref={bodyRef}
        onScroll={onScroll("body")}
        className={cn("overflow-auto", bodyClassName)}
      >
        <div ref={contentRef}>{children}</div>
      </div>
    </>
  );
}
