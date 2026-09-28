-- 0009 — Application-level MIS Sheets (datasets) + per-sheet business-module
-- columns. Purely additive: two new tables, no change to existing tables, so
-- NPL (the existing MIS on the global MisField registry) is untouched.

CREATE TABLE "Sheet" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "isSystem" BOOLEAN NOT NULL DEFAULT false,
  "source" TEXT NOT NULL DEFAULT 'scratch',
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Sheet_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Sheet_name_key" ON "Sheet"("name");

CREATE TABLE "SheetColumn" (
  "id" TEXT NOT NULL,
  "sheetId" TEXT NOT NULL,
  "fieldKey" TEXT NOT NULL,
  "fieldName" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "dataType" TEXT NOT NULL DEFAULT 'TEXT',
  "required" BOOLEAN NOT NULL DEFAULT false,
  "defaultValue" TEXT,
  "options" TEXT,
  "position" INTEGER NOT NULL DEFAULT 0,
  "width" DOUBLE PRECISION,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SheetColumn_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SheetColumn_sheetId_fieldKey_key" ON "SheetColumn"("sheetId", "fieldKey");
CREATE INDEX "SheetColumn_sheetId_position_idx" ON "SheetColumn"("sheetId", "position");
ALTER TABLE "SheetColumn" ADD CONSTRAINT "SheetColumn_sheetId_fkey"
  FOREIGN KEY ("sheetId") REFERENCES "Sheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed the existing NPL application sheet. It is a SYSTEM sheet: its business
-- module is the global MisField registry and its data is the existing
-- MisRecord set (no SheetColumn rows, no data migration).
INSERT INTO "Sheet" ("id", "name", "isSystem", "source", "createdBy", "createdAt", "updatedAt")
VALUES ('sheet-npl', 'NPL', true, 'system', 'system', NOW(), NOW())
ON CONFLICT ("name") DO NOTHING;
