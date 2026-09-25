-- 0006 — Measurement-aware quantity foundation (non-destructive, deterministic).
--
-- Builds on 0005 (which added the "measurement" column + registry field).
-- Three safe, idempotent steps:
--   1. Registry: rename the quantity field's canonical Excel header from the
--      liters-specific "TOTAL QUANTITY IN LTRS" to the new "TOTAL QUANTITY".
--      The physical column (totalQuantityLtrs) and fieldKey are unchanged — only
--      the logical Excel/backend header name changes.
--   2. Backfill: existing NPL rows historically represent liters, so set
--      measurement = 'LTR' where it is NULL and a quantity magnitude exists.
--   3. Identity: the line key now includes the measurement. Existing stored
--      line keys were computed in the old 3-part format
--      (material \n bucket \n qty); extend them to the new 4-part format so a
--      re-import/edit of the same line matches its stored identity instead of
--      creating a phantom duplicate. Deleted rows are skipped (their businessKey
--      is released to NULL on delete, so they are already exempt from matching).

-- ============================================================
-- 1) Registry — canonical header rename (quantity is no longer liters-specific)
-- ============================================================
UPDATE "MisField"
SET "fieldName" = 'TOTAL QUANTITY',
    "displayName" = 'Total Quantity',
    "updatedAt" = NOW()
WHERE "fieldKey" = 'totalQuantityLtrs'
  AND "fieldName" = 'TOTAL QUANTITY IN LTRS';

-- ============================================================
-- 2+3) Backfill measurement = 'LTR' AND extend the stored line key in lockstep,
--      only for live rows that have a quantity and no measurement yet.
--      Appending E'\n' || 'LTR' reproduces buildLineKey(..., 'LTR') exactly,
--      because normalizeMeasurement('LTR') === 'LTR'.
-- ============================================================
UPDATE "MisRecord"
SET "measurement" = 'LTR',
    "lineKey" = "lineKey" || E'\n' || 'LTR'
WHERE "measurement" IS NULL
  AND "totalQuantityLtrs" IS NOT NULL
  AND "deletedAt" IS NULL;

-- Live rows with NO quantity keep measurement NULL, but their stored line key
-- must still gain the 4th part so it matches the new computeRecordKeys output
-- (a missing unit canonicalizes to 'Unspecified' via normalizeMeasurement).
UPDATE "MisRecord"
SET "lineKey" = "lineKey" || E'\n' || 'Unspecified'
WHERE "measurement" IS NULL
  AND "totalQuantityLtrs" IS NULL
  AND "deletedAt" IS NULL;
