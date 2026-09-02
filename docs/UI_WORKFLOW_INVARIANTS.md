# CIJD UI + workflow invariants

- Use DAISHIN-style interaction patterns as the default reference for CIJD: compact queues, whole-row/card selection, focused modal/sheet editing, one obvious primary action, and no duplicated controls.
- Do not place multiple unrelated actions inside list rows. Selecting a row opens its focused detail/edit sheet; actions live there unless the action is truly one-tap and unambiguous.
- Keep forms visually calm: one logical section at a time, no cramped multi-column layouts inside narrow sheets, and no nested summary cards unless they add a real decision.
- Design and Printing are sibling operational workspaces. Their queue pages must share the same visual grammar: same content width, title scale, summary placement, search field, primary create action placement, card radius, row spacing, and responsive behavior. Do not invent a unique header/toolbar pattern for one of them.
- On mobile, queue creation follows one consistent pattern: summary header first, full-width search, then a full-width primary create button. On wider screens, search and create action may sit on one row.
- A workspace tab may describe a workflow stage, while the page heading describes the actual workspace/activity. For Design's active queue, the page heading is `Designing`; the tab remains `In Progress`.
- Summary money belongs at the right side of the page heading and must remain compact. Do not rebuild large centered rate/total blocks on individual pages. Office exchange-rate evidence belongs in the shared thin rate strip; Accounting/Archive may show a small KHR equivalent beside their USD total.
- Use the same rounded project container treatment for active Design and Printing queues. Item-specific status and amounts may differ, but hierarchy and spacing should feel identical.
- Any quantity × price workflow must support bidirectional entry: editing unit recalculates total; editing total recalculates unit. The last field edited is the source of truth while quantity changes.
- PRINT cost and customer billing are separate facts. Printing edits internal cost only. Designer/Billing may edit customer billing. Never label customer billing as print cost.
- PRINT cost must be confirmed before delivery can advance it to Ready to Invoice.
- Project titles and editable project/item facts must be correctable in-place via modal/sheet before invoicing.
- Active work queues are FIFO (oldest actionable work first); history may be newest-first.
