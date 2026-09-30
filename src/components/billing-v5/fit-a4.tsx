"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** A4 width at 96 dpi. */
const A4_WIDTH = 794;
const A4_HEIGHT = 1123;

/**
 * Shows the A4 sheet at full size when there is room and scaled down to the
 * available width when there is not. The height follows the sheet, so an
 * invoice that runs onto a second page is shown whole. Printing ignores it.
 */
export function FitA4({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [height, setHeight] = useState(A4_HEIGHT);

  useEffect(() => {
    const element = outer.current;
    const content = inner.current;
    if (!element || !content) return;
    const measure = () => {
      setScale(Math.min(1, element.clientWidth / A4_WIDTH));
      setHeight(Math.max(A4_HEIGHT, content.scrollHeight));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={outer} className="v5-invoice-fit w-full" style={{ height: height * scale }}>
      <div ref={inner} style={{ width: A4_WIDTH, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        {children}
      </div>
    </div>
  );
}
