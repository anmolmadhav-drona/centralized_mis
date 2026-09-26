-- 0008 — Quantity is now unit-independent: the magnitude lives in
-- "totalQuantity" and the unit lives in "measurement". Rename the physical
-- column and the registry field key in place — a true rename, no second column,
-- no copy/drop, no data conversion.
--
-- Data safety: RENAME preserves every existing value (e.g. 4000 stays 4000);
-- measurement values are untouched; line keys are not rewritten.

-- 1) Physical column rename (always present — created by 0001_init).
ALTER TABLE "MisRecord" RENAME COLUMN "totalQuantityLtrs" TO "totalQuantity";

-- 2) Registry field key rename (guarded: on a freshly-migrated, unseeded DB the
--    row is absent — the seed then creates 'totalQuantity' directly). Position
--    is left unchanged, so Measurement stays immediately after it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "MisField" WHERE "fieldKey" = 'totalQuantityLtrs') THEN
    UPDATE "MisField"
      SET "fieldKey" = 'totalQuantity',
          "fieldName" = 'TOTAL QUANTITY',
          "displayName" = 'Total Quantity',
          "updatedAt" = NOW()
      WHERE "fieldKey" = 'totalQuantityLtrs';
  END IF;
END $$;
