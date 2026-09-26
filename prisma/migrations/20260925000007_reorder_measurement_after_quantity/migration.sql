-- 0007 — MIS column order: place "Measurement" immediately after the quantity
-- field. Registry ordering only (position drives grid + Settings column order).
-- No schema, data-value, identity, or logic change.
--
-- Fresh-DB safe: the bulk registry (including the quantity field) is created by
-- the seed, NOT by migrations, so on a freshly-migrated (unseeded) database the
-- 'totalQuantityLtrs' row is absent. Guard the reorder in a DO block so a
-- missing row is a no-op instead of writing NULL into position.
--
-- Historical note: this migration runs BEFORE 0008, so it references the
-- fieldKey by its old name 'totalQuantityLtrs' (the value at this point in the
-- migration history). 0008 renames it afterwards.

DO $$
DECLARE
  q_pos integer;
BEGIN
  SELECT "position" INTO q_pos FROM "MisField" WHERE "fieldKey" = 'totalQuantityLtrs';
  IF q_pos IS NOT NULL THEN
    -- make room: push every field after the quantity field down by one
    -- (Measurement excluded — it is placed explicitly next)
    UPDATE "MisField"
      SET "position" = "position" + 1, "updatedAt" = NOW()
      WHERE "position" > q_pos AND "fieldKey" <> 'measurement';
    -- place Measurement immediately after the quantity field (freed slot)
    UPDATE "MisField"
      SET "position" = q_pos + 1, "updatedAt" = NOW()
      WHERE "fieldKey" = 'measurement';
  END IF;
END $$;
