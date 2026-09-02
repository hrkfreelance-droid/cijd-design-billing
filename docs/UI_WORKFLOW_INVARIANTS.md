# CIJD UI + workflow invariants

- Use DAISHIN-style interaction patterns as the default reference for CIJD: compact queues, whole-row/card selection, focused modal/sheet editing, one obvious primary action, and no duplicated controls.
- Do not place multiple unrelated actions inside list rows. Selecting a row opens its focused detail/edit sheet; actions live there unless the action is truly one-tap and unambiguous.
- Keep forms visually calm: one logical section at a time, no cramped multi-column layouts inside narrow sheets, and no nested summary cards unless they add a real decision.
- Any quantity × price workflow must support bidirectional entry: editing unit recalculates total; editing total recalculates unit. The last field edited is the source of truth while quantity changes.
- PRINT cost and customer billing are separate facts. Printing edits internal cost only. Designer/Billing may edit customer billing. Never label customer billing as print cost.
- PRINT cost must be confirmed before delivery can advance it to Ready to Invoice.
- Project titles and editable project/item facts must be correctable in-place via modal/sheet before invoicing.
- Active work queues are FIFO (oldest actionable work first); history may be newest-first.
