-- 0004 — Latest workbook format support (non-destructive, preserves all data).
--
-- Schema: 5 genuinely missing core columns, all NULLABLE (existing rows keep
--         NULL — no data loss, no backfill assumptions).
-- Registry: registers the 5 new core fields, renames the legacy "Remarsk"
--         Excel header to the correct "Remark" (same canonical `remark`
--         field — no duplicate field created), and repositions the affected
--         fields so the registry order matches the latest workbook column
--         order (position drives grid / form / export column order).
--
-- The blank column after "Total Rate" in the latest workbook is intentionally
-- NOT modeled (no business meaning).

-- ============================================================
-- 1) Schema — 5 new nullable core columns
-- ============================================================
ALTER TABLE "MisRecord" ADD COLUMN "dispatchFrom" TEXT;
ALTER TABLE "MisRecord" ADD COLUMN "vehicleRate" DOUBLE PRECISION;
ALTER TABLE "MisRecord" ADD COLUMN "km" DOUBLE PRECISION;
ALTER TABLE "MisRecord" ADD COLUMN "rate" DOUBLE PRECISION;
ALTER TABLE "MisRecord" ADD COLUMN "totalRate" DOUBLE PRECISION;

-- ============================================================
-- 2) Field registry — register the 5 new core fields
--    (ON CONFLICT DO NOTHING keeps the migration safe on databases where
--    an equivalent field was already provisioned manually)
-- ============================================================
INSERT INTO "MisField" ("id", "fieldKey", "fieldName", "displayName", "dataType", "required", "defaultValue", "options", "position", "isCore", "isSystem", "active", "width", "createdBy", "createdAt", "updatedAt")
VALUES
  ('fld-core-dispatchfrom', 'dispatchFrom', 'DispatchFrom', 'Dispatch From', 'TEXT', false, NULL, NULL, 29, true, false, true, 18, 'system', NOW(), NOW()),
  ('fld-core-vehiclerate',  'vehicleRate',  'Vehicle Rate', 'Vehicle Rate', 'DECIMAL', false, NULL, NULL, 32, true, false, true, 16, 'system', NOW(), NOW()),
  ('fld-core-km',           'km',           'KM',           'KM', 'DECIMAL', false, NULL, NULL, 34, true, false, true, 12, 'system', NOW(), NOW()),
  ('fld-core-rate',         'rate',         'Rate',         'Rate', 'DECIMAL', false, NULL, NULL, 35, true, false, true, 14, 'system', NOW(), NOW()),
  ('fld-core-totalrate',    'totalRate',    'Total Rate',   'Total Rate', 'DECIMAL', false, NULL, NULL, 36, true, false, true, 16, 'system', NOW(), NOW())
ON CONFLICT ("fieldKey") DO NOTHING;

-- ============================================================
-- 3) Field registry — canonical Excel header correction
--    "Remarsk" (legacy workbook typo) → "Remark" (correct header).
--    Same canonical fieldKey `remark` — NOT a new field.
-- ============================================================
UPDATE "MisField" SET "fieldName" = 'Remark', "updatedAt" = NOW()
WHERE "fieldKey" = 'remark' AND "fieldName" = 'Remarsk';

-- ============================================================
-- 4) Field registry — position alignment with the latest workbook order
--    (dispatchDate 28 → dispatchFrom 29 → dispatchVehicle 30 → vendorName 31
--     → vehicleRate 32 → podStatus 33 → km 34 → rate 35 → totalRate 36;
--     legacy non-workbook fields follow at 37/38)
-- ============================================================
UPDATE "MisField" SET "position" = 30, "updatedAt" = NOW() WHERE "fieldKey" = 'dispatchVehicle';
UPDATE "MisField" SET "position" = 31, "updatedAt" = NOW() WHERE "fieldKey" = 'vendorName';
UPDATE "MisField" SET "position" = 33, "updatedAt" = NOW() WHERE "fieldKey" = 'podStatus';
UPDATE "MisField" SET "position" = 37, "updatedAt" = NOW() WHERE "fieldKey" = 'routeCode2';
UPDATE "MisField" SET "position" = 38, "updatedAt" = NOW() WHERE "fieldKey" = 'e2eSealStatus';
