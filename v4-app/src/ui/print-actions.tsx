"use client";

export function PrintActions() {
  return <div className="print-actions"><button onClick={() => window.print()}>Print / Save PDF</button><button onClick={() => window.close()}>Close</button></div>;
}
