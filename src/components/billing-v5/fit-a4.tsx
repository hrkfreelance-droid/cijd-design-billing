"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import { A4_HEIGHT_PX, A4_WIDTH_PX, invoicePageScale } from "./print-fit";

/**
 * The invoice is one A4 page both on screen and in printed/PDF output.
 * A long invoice stays in its original DOM/layout; only its final rendering
 * is scaled proportionally to fit, as with Excel's Fit to One Page.
 */
export function FitA4({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [screenScale, setScreenScale] = useState(1);
  const [viewportScale, setViewportScale] = useState(1);

  useEffect(() => {
    const element = outer.current;
    const content = inner.current;
    if (!element || !content) return;

    const measure = () => {
      // scrollHeight is the untransformed document height, including signatures.
      const naturalHeight = Math.max(A4_HEIGHT_PX, content.scrollHeight);
      const printScale = invoicePageScale(naturalHeight);
      const widthScale = Math.min(1, element.clientWidth / A4_WIDTH_PX);
      element.style.setProperty("--v5-print-scale", String(printScale));
      setViewportScale(widthScale);
      setScreenScale(widthScale * printScale);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    observer.observe(content);
    window.addEventListener("beforeprint", measure);
    // Loaded Khmer web fonts or the logo can change the document's height.
    void document.fonts?.ready.then(measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("beforeprint", measure);
    };
  }, []);

  return (
    <div
      ref={outer}
      className="v5-invoice-fit w-full"
      style={{ height: A4_HEIGHT_PX * viewportScale }}
    >
      <div
        ref={inner}
        className="v5-invoice-page-content"
        style={{
          width: A4_WIDTH_PX,
          transform: `scale(${screenScale})`,
          transformOrigin: "top left",
        }}
      >
        {children}
      </div>
    </div>
  );
}
