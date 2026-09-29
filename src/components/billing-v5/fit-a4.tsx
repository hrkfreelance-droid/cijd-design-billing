"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** A4 at 96 dpi. */
const A4_WIDTH = 794;
const A4_HEIGHT = 1123;

/**
 * Shows a fixed A4 sheet at full size when there is room and scaled down to
 * the available width when there is not. Printing ignores the scale.
 */
export function FitA4({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    const element = outer.current;
    if (!element) return;
    const measure = () => setScale(Math.min(1, element.clientWidth / A4_WIDTH));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={outer} className="v5-invoice-fit w-full" style={{ height: A4_HEIGHT * scale }}>
      <div style={{ width: A4_WIDTH, transform: `scale(${scale})`, transformOrigin: "top left" }}>{children}</div>
    </div>
  );
}
