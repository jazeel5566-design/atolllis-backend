-- AlterTable
ALTER TABLE "Facility" ADD COLUMN     "nameDhivehi" TEXT,
ADD COLUMN     "reportNoteDhivehi" TEXT,
ADD COLUMN     "reportTitleDhivehi" TEXT;

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "nameDhivehi" TEXT;

-- CreateTable
CREATE TABLE "ReportHandover" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "receiverName" TEXT,
    "receiverPhone" TEXT,
    "handedBy" TEXT NOT NULL,
    "handedById" TEXT,
    "handedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportHandover_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReportHandover_orderId_idx" ON "ReportHandover"("orderId");

-- CreateIndex
CREATE INDEX "ReportHandover_facilityId_handedAt_idx" ON "ReportHandover"("facilityId", "handedAt");

-- AddForeignKey
ALTER TABLE "ReportHandover" ADD CONSTRAINT "ReportHandover_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Permissions for the report viewer (data, not schema; an admin can change them afterwards under
-- Settings). view_reports opens the viewer; dispatch_reports records a hand-over;
-- view_patient_records shows results before the report is final and opens a patient's folder.
-- Reception clerks and phlebotomists hand out final reports only; clinicians read everything but
-- hand nothing out; lab roles keep everything they could see before.
INSERT INTO "RoleCapability" ("id", "role", "capability")
SELECT r.role || '_' || r.capability, r.role, r.capability
FROM (VALUES
  ('reception_clerk', 'view_reports'), ('reception_clerk', 'dispatch_reports'),
  ('clinician', 'view_reports'), ('clinician', 'view_patient_records'),
  ('phlebotomist', 'view_reports'), ('phlebotomist', 'dispatch_reports'),
  ('technologist', 'view_reports'), ('technologist', 'dispatch_reports'), ('technologist', 'view_patient_records'),
  ('pathologist', 'view_reports'), ('pathologist', 'dispatch_reports'), ('pathologist', 'view_patient_records'),
  ('lab_manager', 'view_reports'), ('lab_manager', 'dispatch_reports'), ('lab_manager', 'view_patient_records'),
  ('admin', 'view_reports'), ('admin', 'dispatch_reports'), ('admin', 'view_patient_records')
) AS r(role, capability)
ON CONFLICT ("role", "capability") DO NOTHING;
