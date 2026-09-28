-- 0010 — Generic record storage for in-app sheets. Additive: one new table,
-- isolated by sheetId. NPL is unaffected (it keeps using MisRecord).

CREATE TABLE "SheetRecord" (
  "id" TEXT NOT NULL,
  "sheetId" TEXT NOT NULL,
  "data" TEXT NOT NULL DEFAULT '{}',
  "version" INTEGER NOT NULL DEFAULT 1,
  "deletedAt" TIMESTAMP(3),
  "createdBy" TEXT,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SheetRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SheetRecord_sheetId_deletedAt_idx" ON "SheetRecord"("sheetId", "deletedAt");
ALTER TABLE "SheetRecord" ADD CONSTRAINT "SheetRecord_sheetId_fkey"
  FOREIGN KEY ("sheetId") REFERENCES "Sheet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
