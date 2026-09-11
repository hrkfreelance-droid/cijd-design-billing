import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

const sheet = read("src/components/ui/mobile-bottom-sheet.tsx");
const styles = read("src/components/ui/mobile-bottom-sheet.module.css");
const billingModal = read("src/components/billing-v2/modal.tsx");
const billingBoard = read("src/components/billing-v2/billing-board.tsx");
const projectModal = read("src/components/billing-v2/project-modal.tsx");
const sharedSheet = read("src/components/ui.tsx");

assert.match(sheet, /@base-ui\/react\/drawer/);
assert.match(sheet, /OPEN_SNAP_POINT[^=]*= 0\.94/);
assert.match(sheet, /swipeDirection="down"/);
assert.match(sheet, /snapPoints=\{SNAP_POINTS\}/);
assert.match(sheet, /data-daishin-sheet-scroll="true"/);
assert.match(sheet, /data-base-ui-swipe-ignore/);
assert.match(sheet, /paddingBottom: "calc\(env\(safe-area-inset-bottom\) \+ 112px\)"/);
assert.match(sheet, /eventDetails\.cancel\(\)/);
assert.doesNotMatch(sheet, /CLOSE_ANIMATION_MS|closeTimerRef|finishClose|setDrawerOpen/);
assert.doesNotMatch(sheet, /onPointer(?:Down|Move|Up|Cancel)|onTouch(?:Start|Move|End|Cancel)/);

assert.match(styles, /var\(--drawer-snap-point-offset\) \+ var\(--drawer-swipe-movement-y\)/);
assert.match(styles, /\.backdrop\[data-swiping\][\s\S]*transition-duration: 0ms/);
assert.match(styles, /\.popup\[data-swiping\][\s\S]*transition-duration: 0ms/);
assert.match(styles, /overscroll-behavior: contain/);
assert.match(styles, /touch-action: pan-y/);
assert.match(styles, /env\(safe-area-inset-bottom\)/);
assert.match(styles, /100dvh/);
assert.match(styles, /\.footer[\s\S]*position: absolute/);
assert.match(styles, /--cijd-sheet-snap-offset: var\(--drawer-snap-point-offset\)/);
assert.match(styles, /bottom: var\(--cijd-sheet-snap-offset, 0px\)/);

assert.match(billingModal, /MobileBottomSheet/);
assert.match(billingModal, /sm:items-center/);
assert.match(billingBoard, /v2-printing-cost-outstanding/);
assert.match(billingBoard, /v2-selection-mark-ready/);
assert.match(billingBoard, /v2-selection-move-in-progress/);
assert.match(billingBoard, /api\(.*readiness/);
assert.match(projectModal, /data-testid="v2-modal-save"/);
assert.match(projectModal, /data-testid="v2-move-in-progress"/);
assert.match(projectModal, /data-testid="v2-readiness-action"/);
assert.match(projectModal, /data-testid="v2-mark-ready"/);
assert.match(projectModal, /project\.blocker === null/);
assert.match(sharedSheet, /MobileBottomSheet/);

console.log("mobile sheet regression guard: PASS");
