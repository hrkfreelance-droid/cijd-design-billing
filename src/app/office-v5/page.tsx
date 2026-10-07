"use client";

import { useState } from "react";
import { BillingV3Board } from "@/components/billing-v3/billing-board";
import { BoardSkeleton } from "@/components/billing-v3/v3-shell";
import { useData } from "@/components/providers";
import { Select } from "@/components/ui";
import { workSnapshot } from "@/lib/billing-v5/work-types";
import type { WorkType } from "@/lib/types";

export default function BillingV5Page() {
  const { snapshot } = useData();
  const [type, setType] = useState<WorkType>("DESIGN");
  if (!snapshot) return <BoardSkeleton />;
  return <BillingV3Board key={type} snapshot={workSnapshot(snapshot, type)} accountingFlow workType={type}
    workControl={<label className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-muted">Work Type:
      <Select aria-label="Work Type" data-testid="v5-work-type" value={type} onChange={e => setType(e.target.value as WorkType)}>
        <option value="DESIGN">Design</option><option value="OTHER_BUSINESS">Other Business</option>
      </Select></label>} />;
}
