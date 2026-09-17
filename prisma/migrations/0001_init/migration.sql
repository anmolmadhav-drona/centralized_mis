-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MisField" (
    "id" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "fieldName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "dataType" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "defaultValue" TEXT,
    "options" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "isCore" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "width" DOUBLE PRECISION,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MisField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MisRecord" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "pickupLocation" TEXT,
    "partyName" TEXT,
    "destination" TEXT,
    "invoiceNumber" TEXT,
    "lrNo" INTEGER,
    "lrDate" TIMESTAMP(3),
    "routeCode" TEXT,
    "materialDetails" TEXT,
    "transporterName" TEXT,
    "bucket" INTEGER,
    "totalQuantityLtrs" INTEGER,
    "loadType" TEXT,
    "expectedDeliveryDate" TIMESTAMP(3),
    "actualDeliveryDate" TIMESTAMP(3),
    "deliveryStatus" TEXT,
    "lrStatus" TEXT,
    "damage" TEXT,
    "loadingCharges" DOUBLE PRECISION,
    "unloadingCharges" DOUBLE PRECISION,
    "vehicleNumber" TEXT,
    "vehicleType" INTEGER,
    "ply" INTEGER,
    "remark" TEXT,
    "remarks1" TEXT,
    "dispatchDate" TIMESTAMP(3),
    "dispatchVehicle" TEXT,
    "vendorName" TEXT,
    "routeCode2" TEXT,
    "podStatus" TEXT,
    "businessKey" TEXT,
    "lineKey" TEXT,
    "trackingId" TEXT,
    "liveStatus" TEXT,
    "lastStatusUpdate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MisRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MisFormula" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "formula" TEXT NOT NULL,
    "cachedValue" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MisFormula_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MisValue" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "fieldId" TEXT NOT NULL,
    "valueText" TEXT,
    "valueNumber" DOUBLE PRECISION,
    "valueDate" TIMESTAMP(3),
    "valueBool" BOOLEAN,

    CONSTRAINT "MisValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "fieldName" TEXT,
    "oldValue" TEXT,
    "newValue" TEXT,
    "source" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT,
    "fileName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "stats" TEXT,
    "payload" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "result" TEXT,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE UNIQUE INDEX "MisField_fieldKey_key" ON "MisField"("fieldKey");

-- CreateIndex
CREATE UNIQUE INDEX "MisField_fieldName_key" ON "MisField"("fieldName");

-- CreateIndex
CREATE INDEX "MisField_position_idx" ON "MisField"("position");

-- CreateIndex
CREATE INDEX "MisField_active_idx" ON "MisField"("active");

-- CreateIndex
CREATE INDEX "MisRecord_lrNo_idx" ON "MisRecord"("lrNo");

-- CreateIndex
CREATE INDEX "MisRecord_partyName_idx" ON "MisRecord"("partyName");

-- CreateIndex
CREATE INDEX "MisRecord_destination_idx" ON "MisRecord"("destination");

-- CreateIndex
CREATE INDEX "MisRecord_deliveryStatus_idx" ON "MisRecord"("deliveryStatus");

-- CreateIndex
CREATE INDEX "MisRecord_lrDate_idx" ON "MisRecord"("lrDate");

-- CreateIndex
CREATE INDEX "MisRecord_dispatchDate_idx" ON "MisRecord"("dispatchDate");

-- CreateIndex
CREATE INDEX "MisRecord_vendorName_idx" ON "MisRecord"("vendorName");

-- CreateIndex
CREATE INDEX "MisRecord_podStatus_idx" ON "MisRecord"("podStatus");

-- CreateIndex
CREATE INDEX "MisRecord_loadType_idx" ON "MisRecord"("loadType");

-- CreateIndex
CREATE INDEX "MisRecord_liveStatus_idx" ON "MisRecord"("liveStatus");

-- CreateIndex
CREATE INDEX "MisRecord_trackingId_idx" ON "MisRecord"("trackingId");

-- CreateIndex
CREATE INDEX "MisRecord_updatedAt_idx" ON "MisRecord"("updatedAt");

-- CreateIndex
CREATE INDEX "MisRecord_deletedAt_idx" ON "MisRecord"("deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "MisRecord_businessKey_lineKey_key" ON "MisRecord"("businessKey", "lineKey");

-- CreateIndex
CREATE INDEX "MisFormula_fieldKey_idx" ON "MisFormula"("fieldKey");

-- CreateIndex
CREATE UNIQUE INDEX "MisFormula_recordId_fieldKey_key" ON "MisFormula"("recordId", "fieldKey");

-- CreateIndex
CREATE INDEX "MisValue_fieldId_valueText_idx" ON "MisValue"("fieldId", "valueText");

-- CreateIndex
CREATE INDEX "MisValue_fieldId_valueNumber_idx" ON "MisValue"("fieldId", "valueNumber");

-- CreateIndex
CREATE INDEX "MisValue_fieldId_valueDate_idx" ON "MisValue"("fieldId", "valueDate");

-- CreateIndex
CREATE UNIQUE INDEX "MisValue_recordId_fieldId_key" ON "MisValue"("recordId", "fieldId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_entity_idx" ON "AuditLog"("entity");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "ImportJob_createdAt_idx" ON "ImportJob"("createdAt");

-- AddForeignKey
ALTER TABLE "MisFormula" ADD CONSTRAINT "MisFormula_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "MisRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MisValue" ADD CONSTRAINT "MisValue_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "MisRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MisValue" ADD CONSTRAINT "MisValue_fieldId_fkey" FOREIGN KEY ("fieldId") REFERENCES "MisField"("id") ON DELETE CASCADE ON UPDATE CASCADE;

