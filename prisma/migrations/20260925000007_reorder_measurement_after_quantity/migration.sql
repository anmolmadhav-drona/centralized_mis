-- 0007 — MIS column order: place "Measurement" immediately after "TOTAL QUANTITY".
--
-- Registry ordering only (position drives grid + Settings column order). No
-- schema, data-value, identity, or logic change. Measurement was registered at
-- a trailing position by 0005; this moves it directly after totalQuantityLtrs
-- and shifts every field that follows totalQuantityLtrs down by one, preserving
-- the relative order of all other fields.
--
-- Written relative to the live position of totalQuantityLtrs (not hard-coded
-- numbers), so it is correct regardless of the exact stored positions.

-- 1) Make room: push every field positioned after TOTAL QUANTITY down by one
--    (Measurement excluded — it is placed explicitly in step 2).
UPDATE "MisField"
SET "position" = "position" + 1, "updatedAt" = NOW()
WHERE "position" > (SELECT "position" FROM "MisField" WHERE "fieldKey" = 'totalQuantityLtrs')
  AND "fieldKey" <> 'measurement';

-- 2) Place Measurement immediately after TOTAL QUANTITY (into the freed slot).
UPDATE "MisField"
SET "position" = (SELECT "position" FROM "MisField" WHERE "fieldKey" = 'totalQuantityLtrs') + 1,
    "updatedAt" = NOW()
WHERE "fieldKey" = 'measurement';
