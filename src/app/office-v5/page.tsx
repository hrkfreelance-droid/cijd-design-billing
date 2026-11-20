"use client";

import { useMemo } from "react";
import { BillingV3Board } from "@/components/billing-v3/billing-board";
import { BoardSkeleton } from "@/components/billing-v3/v3-shell";
import { useData } from "@/components/providers";
import { useProjectViews } from "@/components/billing-v5/workspace-shell";
import { projectHref } from "@/components/billing-v5/workspace-parts";
import { billingBoard } from "@/lib/billing-v2/board";
import { designProjects } from "@/lib/billing-v5/project-view";

export default function BillingV5Page() {
  const { snapshot } = useData();
  const projects = useProjectViews();
  const sections = useMemo(() => snapshot && billingBoard(snapshot, designProjects(projects)), [snapshot, projects]);
  if (!snapshot || !sections) return <BoardSkeleton />;
  return <BillingV3Board snapshot={snapshot} accountingFlow sections={sections} projectLink={(id) => projectHref(id, "source=design")} />;
}
