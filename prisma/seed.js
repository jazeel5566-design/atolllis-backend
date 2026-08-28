require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

async function main() {
  // ---------- Facilities (three-tier network) ----------
  const regional = await prisma.facility.create({ data: { id: 'reg1', name: 'National Regional Hospital Laboratory', tier: 'regional' } });
  const atoll1 = await prisma.facility.create({ data: { id: 'atoll1', name: 'Ari Atoll Hospital', tier: 'atoll' } });
  const atoll2 = await prisma.facility.create({ data: { id: 'atoll2', name: 'Faafu Atoll Hospital', tier: 'atoll' } });
  const hc1 = await prisma.facility.create({ data: { id: 'hc1', name: 'Thundufushi Health Centre', tier: 'health_centre', parentAtollId: atoll1.id } });
  const hc2 = await prisma.facility.create({ data: { id: 'hc2', name: 'Maalhos Health Centre', tier: 'health_centre', parentAtollId: atoll1.id } });
  const hc3 = await prisma.facility.create({ data: { id: 'hc3', name: 'Nilandhoo Health Centre', tier: 'health_centre', parentAtollId: atoll2.id } });

  // ---------- One demo user per facility, plus a few role-specific accounts to try out ----------
  const passwordHash = await bcrypt.hash('password123', 10);
  for (const f of [regional, atoll1, atoll2, hc1, hc2, hc3]) {
    // Regional's own login is the system administrator; every other facility's default login is
    // a Lab Manager, so existing demo credentials keep full local capability after this change.
    const role = f.id === regional.id ? 'admin' : 'lab_manager';
    await prisma.user.create({
      data: {
        name: `${f.name} ${role === 'admin' ? 'Administrator' : 'Lab Manager'}`, username: f.id, passwordHash, role, facilityId: f.id,
        facilityAccess: { create: [{ id: `UFA-${f.id}`, facilityId: f.id }] },
      },
    });
  }
  // Extra accounts at Thundufushi HC to demonstrate role differences without extra facilities.
  const demoRoles = [
    { username: 'hc1_phleb', name: 'Thundufushi Phlebotomist Demo', role: 'phlebotomist' },
    { username: 'hc1_tech', name: 'Thundufushi Technologist Demo', role: 'technologist' },
    { username: 'hc1_path', name: 'Thundufushi Pathologist Demo', role: 'pathologist' },
  ];
  for (const d of demoRoles) {
    await prisma.user.create({
      data: {
        name: d.name, username: d.username, passwordHash, role: d.role, facilityId: hc1.id,
        facilityAccess: { create: [{ id: `UFA-${d.username}`, facilityId: hc1.id }] },
      },
    });
  }

  // ---------- Default role → capability assignment (editable later under Settings → Users) ----------
  const defaultRoleCapabilities = {
    phlebotomist: ['collect'],
    technologist: ['collect', 'accept', 'process'],
    pathologist: ['collect', 'accept', 'process', 'certify'],
    lab_manager: ['collect', 'accept', 'process', 'certify', 'manage_users', 'view_audit'],
    admin: ['collect', 'accept', 'process', 'certify', 'manage_users', 'manage_catalog', 'manage_labs', 'view_audit'],
  };
  for (const [role, capabilities] of Object.entries(defaultRoleCapabilities)) {
    for (const capability of capabilities) {
      await prisma.roleCapability.create({ data: { id: `${role}_${capability}`, role, capability } });
    }
  }

  // ---------- Test categories (managed list — controls barcode letters) ----------
  const categoryDefs = [
    { id: 'CAT-HEM', name: 'Hematology', letter: 'H' },
    { id: 'CAT-BIO', name: 'Biochemistry', letter: 'B' },
    { id: 'CAT-SER', name: 'Serology', letter: 'S' },
    { id: 'CAT-CLP', name: 'Clinical Pathology', letter: 'C' },
    { id: 'CAT-MIC', name: 'Microbiology', letter: 'M' },
  ];
  for (const c of categoryDefs) {
    await prisma.testCategory.create({ data: c });
  }

  // ---------- Test catalog ----------
  const tests = [
    { code: 'GLU', name: 'Fasting Blood Glucose', category: 'Biochemistry', specimenType: 'Serum (Fluoride Oxalate)', method: 'Hexokinase', units: 'mg/dL', tat: 2, minTier: 'health_centre', criticalLow: 40, criticalHigh: 400, comment: 'Patient should fast 8\u201312 hours prior to sample collection.', refRanges: [{ sex: 'Any', ageMin: 0, ageMax: 150, low: 70, high: 100 }] },
    { code: 'HGB', name: 'Haemoglobin', category: 'Hematology', specimenType: 'Whole Blood (EDTA)', method: 'Automated Cell Counter \u2013 SLS method', units: 'g/dL', tat: 1, minTier: 'health_centre', criticalLow: 6, criticalHigh: 20, comment: '', refRanges: [{ sex: 'M', ageMin: 12, ageMax: 150, low: 13.5, high: 17.5 }, { sex: 'F', ageMin: 12, ageMax: 150, low: 12, high: 15.5 }, { sex: 'Any', ageMin: 0, ageMax: 12, low: 11, high: 14 }] },
    { code: 'CREA', name: 'Serum Creatinine', category: 'Biochemistry', specimenType: 'Serum', method: 'Jaffe Kinetic', units: 'mg/dL', tat: 3, minTier: 'atoll', criticalLow: 0.2, criticalHigh: 7, comment: '', refRanges: [{ sex: 'M', ageMin: 18, ageMax: 150, low: 0.7, high: 1.3 }, { sex: 'F', ageMin: 18, ageMax: 150, low: 0.6, high: 1.1 }] },
    { code: 'TSH', name: 'Thyroid Stimulating Hormone', category: 'Biochemistry', specimenType: 'Serum', method: 'Chemiluminescent Immunoassay (CLIA)', units: '\u00b5IU/mL', tat: 24, minTier: 'atoll', criticalLow: 0.05, criticalHigh: 50, comment: 'Biotin supplementation may interfere \u2014 advise 48h washout before draw.', refRanges: [{ sex: 'Any', ageMin: 18, ageMax: 150, low: 0.4, high: 4.0 }] },
    { code: 'HBA1C', name: 'Glycated Haemoglobin (HbA1c)', category: 'Biochemistry', specimenType: 'Whole Blood (EDTA)', method: 'HPLC', units: '%', tat: 24, minTier: 'atoll', comment: 'Reflects average glycaemic control over the preceding 8\u201312 weeks.', refRanges: [{ sex: 'Any', ageMin: 0, ageMax: 150, low: 4, high: 5.6 }] },
    { code: 'CA125', name: 'Cancer Antigen 125 (CA-125)', category: 'Serology', specimenType: 'Serum', method: 'Electrochemiluminescence Immunoassay (ECLIA)', units: 'U/mL', tat: 72, minTier: 'regional', comment: 'Tumour marker \u2014 interpret alongside clinical and imaging findings; not diagnostic alone.', refRanges: [{ sex: 'Any', ageMin: 0, ageMax: 150, low: 0, high: 35 }] },
  ];
  for (const t of tests) {
    await prisma.testDefinition.create({
      data: {
        code: t.code, name: t.name, category: t.category, specimenType: t.specimenType, method: t.method, units: t.units,
        tat: t.tat, minTier: t.minTier, criticalLow: t.criticalLow ?? null, criticalHigh: t.criticalHigh ?? null, comment: t.comment || '',
        refRanges: { create: t.refRanges },
      },
    });
  }

  // ---------- Patients ----------
  const p1 = await prisma.patient.create({ data: { id: 'PT1001', name: 'Aishath Nasheedha', idNumber: 'A123456', hospitalNumber: 'H-00981', dob: '1988-04-12', sex: 'F', address: 'Thundufushi, Ari Atoll', homeFacilityId: hc1.id } });
  const p2 = await prisma.patient.create({ data: { id: 'PT1002', name: 'Mohamed Rasheed', idNumber: 'A234567', hospitalNumber: 'H-01452', dob: '1975-11-02', sex: 'M', address: 'Maalhos, Ari Atoll', homeFacilityId: hc2.id } });
  const p3 = await prisma.patient.create({ data: { id: 'PT1003', name: 'Fathimath Shifa', idNumber: 'A345678', hospitalNumber: 'H-02210', dob: '1995-06-20', sex: 'F', address: 'Nilandhoo, Faafu Atoll', homeFacilityId: hc3.id } });

  // ---------- Mock HIS / Billing memos (external system stand-in) ----------
  await prisma.mockHisMemo.create({ data: { memoNumber: 'HIS-2026-004821', source: 'HIS', orderedBy: 'Dr. Aminath Shaba', patientName: p1.name, patientIdNumber: p1.idNumber, patientHospitalNumber: p1.hospitalNumber, patientDob: p1.dob, patientSex: p1.sex, patientAddress: p1.address, testCodes: JSON.stringify(['GLU', 'HGB']) } });
  await prisma.mockHisMemo.create({ data: { memoNumber: 'BILL-2026-071190', source: 'Billing', orderedBy: 'Dr. Ibrahim Shaan', patientName: p2.name, patientIdNumber: p2.idNumber, patientHospitalNumber: p2.hospitalNumber, patientDob: p2.dob, patientSex: p2.sex, patientAddress: p2.address, testCodes: JSON.stringify(['GLU', 'CREA', 'CA125']) } });
  await prisma.mockHisMemo.create({ data: { memoNumber: 'HIS-2026-004900', source: 'HIS', orderedBy: 'Dr. Mariyam Nazly', patientName: p3.name, patientIdNumber: p3.idNumber, patientHospitalNumber: p3.hospitalNumber, patientDob: p3.dob, patientSex: p3.sex, patientAddress: p3.address, testCodes: JSON.stringify(['TSH', 'HBA1C']) } });

  console.log('\nSeed complete.\n');
  console.log('Demo logins (facility / username / password / role):');
  console.log('  Regional Hospital : reg1   / reg1   / password123 / admin');
  console.log('  Ari Atoll Hospital: atoll1 / atoll1 / password123 / lab_manager');
  console.log('  Faafu Atoll Hosp. : atoll2 / atoll2 / password123 / lab_manager');
  console.log('  Thundufushi HC    : hc1    / hc1    / password123 / lab_manager');
  console.log('  Maalhos HC        : hc2    / hc2    / password123 / lab_manager');
  console.log('  Nilandhoo HC      : hc3    / hc3    / password123 / lab_manager');
  console.log('\nExtra role demo accounts, all at Thundufushi HC (facility "hc1"):');
  console.log('  hc1_phleb / password123 / phlebotomist');
  console.log('  hc1_tech  / password123 / technologist');
  console.log('  hc1_path  / password123 / pathologist');
  console.log('\nTry-it memo numbers: HIS-2026-004821, BILL-2026-071190, HIS-2026-004900\n');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
