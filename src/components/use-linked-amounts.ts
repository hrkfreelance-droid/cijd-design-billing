"use client";

import { useEffect, useMemo, useState } from "react";

export type LinkedAmountSource = "unit" | "total";

export function useLinkedAmounts({
  quantity,
  initialUnit,
  initialTotal,
  initialSource = "unit",
}: {
  quantity: string | number;
  initialUnit?: number | null;
  initialTotal?: number | null;
  initialSource?: LinkedAmountSource;
}) {
  const initialUnitText = initialInput(initialUnit, 6);
  const initialTotalText = initialInput(initialTotal, 2);
  const effectiveInitialSource: LinkedAmountSource =
    initialSource === "unit" && !initialUnitText && initialTotalText
      ? "total"
      : initialSource === "total" && !initialTotalText && initialUnitText
        ? "unit"
        : initialSource;

  const [unit, setUnitValue] = useState(initialUnitText);
  const [total, setTotalValue] = useState(initialTotalText);
  const [source, setSource] = useState<LinkedAmountSource>(effectiveInitialSource);
  const [touched, setTouched] = useState(false);

  const quantityNumber = positive(quantity);

  useEffect(() => {
    if (!quantityNumber) return;
    if (source === "unit") {
      const value = nonNegative(unit);
      setTotalValue(value == null ? "" : formatTotal(quantityNumber * value));
    } else {
      const value = nonNegative(total);
      setUnitValue(value == null ? "" : formatUnit(value / quantityNumber));
    }
    // The active field is intentionally excluded: its onChange handler updates
    // the derived field immediately without rewriting what the person is typing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quantityNumber, source]);

  const setUnit = (value: string) => {
    setTouched(true);
    setSource("unit");
    setUnitValue(value);
    const q = positive(quantity);
    const parsed = nonNegative(value);
    setTotalValue(q && parsed != null ? formatTotal(q * parsed) : "");
  };

  const setTotal = (value: string) => {
    setTouched(true);
    setSource("total");
    setTotalValue(value);
    const q = positive(quantity);
    const parsed = nonNegative(value);
    setUnitValue(q && parsed != null ? formatUnit(parsed / q) : "");
  };

  const unitNumber = useMemo(() => nonNegative(unit), [unit]);
  const totalNumber = useMemo(() => nonNegative(total), [total]);

  return {
    unit,
    total,
    source,
    touched,
    unitNumber,
    totalNumber,
    setUnit,
    setTotal,
  };
}

function positive(value: string | number): number | null {
  const parsed = typeof value === "number" ? value : Number(value.trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function nonNegative(value: string | number): number | null {
  const parsed = typeof value === "number" ? value : value.trim() === "" ? NaN : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function initialInput(value: number | null | undefined, decimals: number): string {
  if (value == null || !Number.isFinite(value) || value <= 0) return "";
  return decimals === 2 ? formatTotal(value) : formatUnit(value);
}

function formatTotal(value: number): string {
  return (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
}

function formatUnit(value: number): string {
  const rounded = Math.round((value + Number.EPSILON) * 1_000_000) / 1_000_000;
  return rounded.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}
