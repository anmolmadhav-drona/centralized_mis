-- 0005 — Measurement-aware quantity (non-destructive, preserves all data).
--
-- The MIS structure now pairs TOTAL QUANTITY with a Measurement (unit). The
-- quantity magnitude continues to live in the existing "totalQuantityLtrs"
-- column; this migration adds the paired unit column plus a registry entry so
-- the field exists in the MIS structure. Existing rows keep NULL measurement
-- (treated as "Unspecified" by reports — no backfill / liters assumption).

-- ============================================================
-- 1) Schema — new nullable core column
-- ============================================================
ALTER TABLE "MisRecord" ADD COLUMN "measurement" TEXT;

-- ============================================================
-- 2) Field registry — register the new core field.
--    Appended at a trailing position so existing column order is undisturbed.
--    ON CONFLICT DO NOTHING keeps the migration safe where the field was
--    already provisioned manually.
-- ============================================================
INSERT INTO "MisField" ("id", "fieldKey", "fieldName", "displayName", "dataType", "required", "defaultValue", "options", "position", "isCore", "isSystem", "active", "width", "createdBy", "createdAt", "updatedAt")
VALUES
  ('fld-core-measurement', 'measurement', 'Measurement', 'Measurement', 'TEXT', false, NULL, NULL, 39, true, false, true, 16, 'system', NOW(), NOW())
ON CONFLICT ("fieldKey") DO NOTHING;
