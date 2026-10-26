-- CreateTable
CREATE TABLE "Facility" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "parentAtollId" TEXT,
    "parentFacilityId" TEXT,
    "urlSlug" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Facility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ward" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Ward_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacilityNetwork" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "cidr" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacilityNetwork_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleCapability" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "capability" TEXT NOT NULL,

    CONSTRAINT "RoleCapability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'technologist',
    "facilityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserFacilityAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserFacilityAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "facilityName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestDefinition" (
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "specimenType" TEXT,
    "method" TEXT,
    "units" TEXT,
    "tat" INTEGER NOT NULL DEFAULT 24,
    "minTier" TEXT NOT NULL,
    "criticalLow" DOUBLE PRECISION,
    "criticalHigh" DOUBLE PRECISION,
    "comment" TEXT,
    "isCulture" BOOLEAN NOT NULL DEFAULT false,
    "isStat" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TestDefinition_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "TestAlias" (
    "id" TEXT NOT NULL,
    "hisCode" TEXT NOT NULL,
    "internalCode" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestPanel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "testCodes" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "TestPanel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RejectionReason" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "RejectionReason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReflexRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "triggerTestCode" TEXT NOT NULL,
    "condition" TEXT NOT NULL,
    "thresholdValue" DOUBLE PRECISION NOT NULL,
    "resultTestCode" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReflexRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferenceRange" (
    "id" SERIAL NOT NULL,
    "testCode" TEXT NOT NULL,
    "sex" TEXT NOT NULL,
    "ageMin" DOUBLE PRECISION NOT NULL,
    "ageMax" DOUBLE PRECISION NOT NULL,
    "ageUnit" TEXT NOT NULL DEFAULT 'Y',
    "low" DOUBLE PRECISION NOT NULL,
    "high" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "ReferenceRange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Patient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "idNumber" TEXT,
    "hospitalNumber" TEXT,
    "dob" TEXT NOT NULL,
    "sex" TEXT NOT NULL,
    "address" TEXT,
    "homeFacilityId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MockHisMemo" (
    "memoNumber" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "orderedBy" TEXT NOT NULL,
    "patientName" TEXT NOT NULL,
    "patientIdNumber" TEXT,
    "patientHospitalNumber" TEXT,
    "patientDob" TEXT NOT NULL,
    "patientSex" TEXT NOT NULL,
    "patientAddress" TEXT,
    "testCodes" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MockHisMemo_pkey" PRIMARY KEY ("memoNumber")
);

-- CreateTable
CREATE TABLE "TestCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "letter" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "memoSource" TEXT NOT NULL,
    "memoNumber" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "orderingFacilityId" TEXT NOT NULL,
    "orderedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sampleStatus" TEXT,
    "collectedAt" TIMESTAMP(3),
    "collectedBy" TEXT,
    "referredAt" TIMESTAMP(3),
    "referredByName" TEXT,
    "patientType" TEXT,
    "wardId" TEXT,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Specimen" (
    "id" TEXT NOT NULL,
    "specimenNumber" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "bottleType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'collected',
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "collectedBy" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "acceptedBy" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Specimen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SpecimenRejection" (
    "id" TEXT NOT NULL,
    "specimenId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "facilityName" TEXT NOT NULL,
    "reasonId" TEXT,
    "reasonName" TEXT NOT NULL,
    "note" TEXT,
    "category" TEXT NOT NULL,
    "rejectedBy" TEXT NOT NULL,
    "rejectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpecimenRejection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderTest" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "needsReferral" BOOLEAN NOT NULL DEFAULT false,
    "referred" BOOLEAN NOT NULL DEFAULT false,
    "performingFacilityId" TEXT NOT NULL,
    "specimenId" TEXT,
    "status" TEXT NOT NULL,
    "value" TEXT,
    "unit" TEXT,
    "enteredAt" TIMESTAMP(3),
    "enteredBy" TEXT,
    "validatedBy" TEXT,
    "validatedAt" TIMESTAMP(3),
    "referredByName" TEXT,
    "criticalFlag" TEXT,
    "criticalNotifiedTo" TEXT,
    "criticalNotifiedAt" TIMESTAMP(3),
    "isStat" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "OrderTest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ResultAmendment" (
    "id" TEXT NOT NULL,
    "orderTestId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "facilityName" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "previousValue" TEXT,
    "previousUnit" TEXT,
    "previousFlag" TEXT,
    "previousEnteredBy" TEXT,
    "previousEnteredAt" TIMESTAMP(3),
    "previousValidatedBy" TEXT,
    "previousValidatedAt" TIMESTAMP(3),
    "newValue" TEXT,
    "newUnit" TEXT,
    "newFlag" TEXT,
    "amendedBy" TEXT NOT NULL,
    "amendedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifyRequired" BOOLEAN NOT NULL DEFAULT false,
    "notifiedTo" TEXT,
    "notifiedMethod" TEXT,
    "notifiedAt" TIMESTAMP(3),
    "notifiedBy" TEXT,

    CONSTRAINT "ResultAmendment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CriticalNotification" (
    "id" TEXT NOT NULL,
    "orderTestId" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "facilityName" TEXT NOT NULL,
    "personName" TEXT NOT NULL,
    "personRole" TEXT,
    "method" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "readBack" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "recordedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CriticalNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Organism" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "group" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Organism_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Antibiotic" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Antibiotic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganismAntibioticPanel" (
    "id" TEXT NOT NULL,
    "organismId" TEXT NOT NULL,
    "antibioticId" TEXT NOT NULL,

    CONSTRAINT "OrganismAntibioticPanel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CultureResult" (
    "id" TEXT NOT NULL,
    "orderTestId" TEXT NOT NULL,
    "growthStatus" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CultureResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganismFinding" (
    "id" TEXT NOT NULL,
    "cultureResultId" TEXT NOT NULL,
    "organismId" TEXT NOT NULL,
    "colonyCount" TEXT,

    CONSTRAINT "OrganismFinding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AntibioticSensitivity" (
    "id" TEXT NOT NULL,
    "organismFindingId" TEXT NOT NULL,
    "antibioticId" TEXT NOT NULL,
    "result" TEXT NOT NULL,

    CONSTRAINT "AntibioticSensitivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Instrument" (
    "id" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT,
    "protocol" TEXT NOT NULL,
    "connection" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "keyPrefix" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Instrument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InstrumentTestMap" (
    "id" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "instrumentCode" TEXT NOT NULL,
    "testCode" TEXT NOT NULL,
    "units" TEXT,
    "acceptBlankUnit" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InstrumentTestMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterfaceMessage" (
    "id" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "instrumentName" TEXT NOT NULL,
    "facilityId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "specimenNumber" TEXT,
    "instrumentCode" TEXT,
    "testCode" TEXT,
    "value" TEXT,
    "unit" TEXT,
    "flags" TEXT,
    "status" TEXT NOT NULL,
    "detail" TEXT,
    "raw" TEXT,
    "orderTestId" TEXT,
    "previousValue" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolveNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterfaceMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Facility_urlSlug_key" ON "Facility"("urlSlug");

-- CreateIndex
CREATE UNIQUE INDEX "Ward_facilityId_name_key" ON "Ward"("facilityId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "RoleCapability_role_capability_key" ON "RoleCapability"("role", "capability");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "UserFacilityAccess_userId_facilityId_key" ON "UserFacilityAccess"("userId", "facilityId");

-- CreateIndex
CREATE UNIQUE INDEX "TestAlias_hisCode_key" ON "TestAlias"("hisCode");

-- CreateIndex
CREATE UNIQUE INDEX "TestPanel_name_key" ON "TestPanel"("name");

-- CreateIndex
CREATE UNIQUE INDEX "RejectionReason_name_key" ON "RejectionReason"("name");

-- CreateIndex
CREATE UNIQUE INDEX "TestCategory_name_key" ON "TestCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "TestCategory_letter_key" ON "TestCategory"("letter");

-- CreateIndex
CREATE UNIQUE INDEX "Order_memoNumber_key" ON "Order"("memoNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Specimen_specimenNumber_key" ON "Specimen"("specimenNumber");

-- CreateIndex
CREATE INDEX "ResultAmendment_orderTestId_idx" ON "ResultAmendment"("orderTestId");

-- CreateIndex
CREATE INDEX "ResultAmendment_facilityId_notifyRequired_notifiedAt_idx" ON "ResultAmendment"("facilityId", "notifyRequired", "notifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Organism_name_key" ON "Organism"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Antibiotic_name_key" ON "Antibiotic"("name");

-- CreateIndex
CREATE UNIQUE INDEX "OrganismAntibioticPanel_organismId_antibioticId_key" ON "OrganismAntibioticPanel"("organismId", "antibioticId");

-- CreateIndex
CREATE UNIQUE INDEX "CultureResult_orderTestId_key" ON "CultureResult"("orderTestId");

-- CreateIndex
CREATE UNIQUE INDEX "Instrument_keyHash_key" ON "Instrument"("keyHash");

-- CreateIndex
CREATE UNIQUE INDEX "Instrument_facilityId_name_key" ON "Instrument"("facilityId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "InstrumentTestMap_instrumentId_instrumentCode_key" ON "InstrumentTestMap"("instrumentId", "instrumentCode");

-- CreateIndex
CREATE UNIQUE INDEX "InstrumentTestMap_instrumentId_testCode_key" ON "InstrumentTestMap"("instrumentId", "testCode");

-- CreateIndex
CREATE INDEX "InterfaceMessage_facilityId_createdAt_idx" ON "InterfaceMessage"("facilityId", "createdAt");

-- CreateIndex
CREATE INDEX "InterfaceMessage_facilityId_status_idx" ON "InterfaceMessage"("facilityId", "status");

-- AddForeignKey
ALTER TABLE "Facility" ADD CONSTRAINT "Facility_parentAtollId_fkey" FOREIGN KEY ("parentAtollId") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Facility" ADD CONSTRAINT "Facility_parentFacilityId_fkey" FOREIGN KEY ("parentFacilityId") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ward" ADD CONSTRAINT "Ward_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacilityNetwork" ADD CONSTRAINT "FacilityNetwork_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFacilityAccess" ADD CONSTRAINT "UserFacilityAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserFacilityAccess" ADD CONSTRAINT "UserFacilityAccess_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "Facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferenceRange" ADD CONSTRAINT "ReferenceRange_testCode_fkey" FOREIGN KEY ("testCode") REFERENCES "TestDefinition"("code") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Patient" ADD CONSTRAINT "Patient_homeFacilityId_fkey" FOREIGN KEY ("homeFacilityId") REFERENCES "Facility"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_orderingFacilityId_fkey" FOREIGN KEY ("orderingFacilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_wardId_fkey" FOREIGN KEY ("wardId") REFERENCES "Ward"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Specimen" ADD CONSTRAINT "Specimen_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpecimenRejection" ADD CONSTRAINT "SpecimenRejection_specimenId_fkey" FOREIGN KEY ("specimenId") REFERENCES "Specimen"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTest" ADD CONSTRAINT "OrderTest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTest" ADD CONSTRAINT "OrderTest_performingFacilityId_fkey" FOREIGN KEY ("performingFacilityId") REFERENCES "Facility"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderTest" ADD CONSTRAINT "OrderTest_specimenId_fkey" FOREIGN KEY ("specimenId") REFERENCES "Specimen"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResultAmendment" ADD CONSTRAINT "ResultAmendment_orderTestId_fkey" FOREIGN KEY ("orderTestId") REFERENCES "OrderTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CriticalNotification" ADD CONSTRAINT "CriticalNotification_orderTestId_fkey" FOREIGN KEY ("orderTestId") REFERENCES "OrderTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganismAntibioticPanel" ADD CONSTRAINT "OrganismAntibioticPanel_organismId_fkey" FOREIGN KEY ("organismId") REFERENCES "Organism"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganismAntibioticPanel" ADD CONSTRAINT "OrganismAntibioticPanel_antibioticId_fkey" FOREIGN KEY ("antibioticId") REFERENCES "Antibiotic"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CultureResult" ADD CONSTRAINT "CultureResult_orderTestId_fkey" FOREIGN KEY ("orderTestId") REFERENCES "OrderTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganismFinding" ADD CONSTRAINT "OrganismFinding_cultureResultId_fkey" FOREIGN KEY ("cultureResultId") REFERENCES "CultureResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganismFinding" ADD CONSTRAINT "OrganismFinding_organismId_fkey" FOREIGN KEY ("organismId") REFERENCES "Organism"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AntibioticSensitivity" ADD CONSTRAINT "AntibioticSensitivity_organismFindingId_fkey" FOREIGN KEY ("organismFindingId") REFERENCES "OrganismFinding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AntibioticSensitivity" ADD CONSTRAINT "AntibioticSensitivity_antibioticId_fkey" FOREIGN KEY ("antibioticId") REFERENCES "Antibiotic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InstrumentTestMap" ADD CONSTRAINT "InstrumentTestMap_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

