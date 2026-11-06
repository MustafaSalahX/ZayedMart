import crypto from 'node:crypto';
import { hashPin, encryptPasswordForAdmin } from './rbac.js';

export const SEED_ROLE_ACCOUNTS = [
  {
    id: 'cabc0e04-6b8f-4f68-9d6f-8d824cfd0ae9',
    username: 'admin',
    display_name: 'إدارة زايد مارت (Admin)',
    role: 'owner',
    password: '123',
    avatar_color: '#7627BB',
  },
];

// No fake data is seeded; all arrays are intentionally empty for 100% real data.
export const SEED_EMPLOYEES = [];
export const SEED_SUPPLIERS = [];
export const SEED_CATALOG = [];
export const SEED_SHORTAGES = [];
export const SEED_ATTENDANCE = [];
export const SEED_TRUCKS = [];
export const SEED_NOTES = [];

// Legacy fake UUIDs to purge from any existing database so only real user data remains.
export const LEGACY_FAKE_USER_IDS = [
  '34cfe3c6-ebd0-4a8a-82e8-5eec90d82753',
  'd5b46bc6-7133-478c-88e6-a7b5e1b234b1',
  'aced9496-4de6-4c96-8b77-d9c9c767b15b',
  'b72805fd-1bbc-46e4-be0b-6dfde9265fc8',
  'de78d971-c394-43da-bbbc-f192787c45d4',
];

export const LEGACY_FAKE_EMPLOYEE_IDS = [
  '6c058b52-c494-4fcc-b611-055defd26ead',
  '7beb37db-3cd9-4eea-b151-4dcc89e3315f',
  'a8db792c-9fcf-4162-9291-a91d45b4794b',
  'c048a0b9-2597-4df7-b31f-b090310f54e8',
  'a02bccd7-e4ab-4177-97e2-ac876af930fa',
  '435d24f9-e1dd-4d37-9e35-80a1a81f76fd',
  '7a142940-8ce3-40bd-93aa-91d511914fc6',
  '35b9ad92-7402-49e0-8c1c-7a851d2bf883',
  'aecff9f9-9f1c-4a7a-841e-9a974be11889',
];

export const LEGACY_FAKE_SUPPLIER_IDS = [
  '5eb728c8-8f8d-4c1c-af04-78ab44e78437',
  '3eb9b36d-5d5f-4920-b43e-bd010cae0f23',
  'c0bdf7e6-6028-4f75-ad14-8c3d8e58681a',
  'd4fe2387-1c39-43c3-9deb-eb9bca6aa4f2',
  '8c60cab7-c708-4cd5-906d-3b324f367835',
  '7081ee3e-5056-4003-af58-cce39cfb7ad1',
];

export const LEGACY_FAKE_CATALOG_IDS = [
  '360210a4-acaf-43bd-bc19-7089a58782fe',
  'ddac66cb-5542-421d-ab9a-0eb409373944',
  '4ceedd52-e78c-401e-b754-7b3bdd65ac2d',
  '8cad60ed-e670-44d1-88f2-c554c2726eef',
  '84137c95-eeb2-4a5b-b8d6-c88fa3509ae4',
  '744a42f2-6619-4ec3-86ed-40a826021de8',
  '62736d6d-e713-408b-9a5d-02f569c649d1',
  '82f9f77d-3b98-4580-8880-8652f7c0786b',
  'bfd593b0-011c-447b-a423-72e748a9d0f5',
  '359290a0-02ca-4935-abec-11dcc9ab1179',
  '5bc9f642-7f97-4185-b10b-cb021027d1d5',
  '182d030e-2595-4800-8bd0-188ffeb28574',
  '6cf3b707-933e-46a3-bed5-32daf03699ae',
  '50f741da-e6d8-41c8-b7ab-9550492e35a9',
  'a52d8149-9dc5-400e-8be1-b383a958a980',
  '7deaed47-ef03-4671-81cc-17d3463fd569',
  'dcbdc0c6-4f29-46eb-84ec-0cbcd959cedf',
];

export const LEGACY_FAKE_SHORTAGE_IDS = [
  '81d648bd-df08-48fc-bfc2-57983cd93398',
  '6cb1c092-48e7-444e-8cbe-6c20e47b28c5',
  '76e7ec95-01e9-430a-81e8-f22a511e5d88',
  'aff78780-992c-4e40-9ed1-69d14ab31210',
  'ef2298e5-e09d-4004-825e-f506c81bb406',
];

export const LEGACY_FAKE_ATTENDANCE_IDS = [
  '7c823f25-c1a3-497f-95b9-d9ca62ea301c',
  'd4f96697-c020-4d8d-8fa5-e62adb17e3bd',
  '124201a6-7934-4de2-a0c4-efaeef49c03a',
  '10c7d628-45cc-4da1-8c43-eaebd50770d5',
];

export const LEGACY_FAKE_TRUCK_IDS = [
  'bd6c93db-5cca-4a49-9f8b-7cb43e71aa29',
  '755d8ba0-57d1-487b-9956-d3b27316bc79',
];

export const LEGACY_FAKE_NOTE_IDS = [
  '919a3e3b-cc9a-4db4-8baf-0f08da3ce6cc',
  'fc21e986-07e6-4beb-b0f9-a84da5df88fb',
];

export function deterministicSaltHex(seedKey) {
  return crypto.createHash('sha256').update(`zayed-salt:${seedKey}`).digest('hex').slice(0, 32);
}

export function purgeLegacyFakeSeedData(db) {
  const delById = (table, ids) => {
    if (!ids.length) return;
    const stmt = db.prepare(`DELETE FROM ${table} WHERE id = ?`);
    for (const id of ids) {
      stmt.run(id);
    }
  };

  delById('system_users', LEGACY_FAKE_USER_IDS);
  const delLinkedUserStmt = db.prepare('DELETE FROM system_users WHERE employee_id = ?');
  const delEmpAttStmt = db.prepare('DELETE FROM attendance_logs WHERE employee_id = ?');
  for (const empId of LEGACY_FAKE_EMPLOYEE_IDS) {
    delLinkedUserStmt.run(empId);
    delEmpAttStmt.run(empId);
  }
  delById('employees', LEGACY_FAKE_EMPLOYEE_IDS);
  delById('suppliers', LEGACY_FAKE_SUPPLIER_IDS);
  delById('product_catalog', LEGACY_FAKE_CATALOG_IDS);
  delById('shortages', LEGACY_FAKE_SHORTAGE_IDS);
  delById('attendance_logs', LEGACY_FAKE_ATTENDANCE_IDS);
  delById('truck_logs', LEGACY_FAKE_TRUCK_IDS);
  delById('notes', LEGACY_FAKE_NOTE_IDS);

  // Clean any test/dummy leftovers so 100% real data remains
  try {
    db.exec(`
      DELETE FROM system_users WHERE employee_id IN (SELECT id FROM employees WHERE name LIKE '%test%' OR name LIKE '%تجربة%' OR emp_code = '123123');
      DELETE FROM attendance_logs WHERE employee_id IN (SELECT id FROM employees WHERE name LIKE '%test%' OR name LIKE '%تجربة%' OR emp_code = '123123');
      DELETE FROM employees WHERE name LIKE '%test%' OR name LIKE '%تجربة%' OR emp_code = '123123';
      DELETE FROM product_catalog WHERE name LIKE '%اختبار%' OR name LIKE '%تجربة%' OR name LIKE '%test%';
      DELETE FROM notes WHERE (content LIKE '%ممنوع%' AND recorded_by LIKE '%عم رجب%') OR content LIKE '%تجربة%' OR content LIKE '%اختبار%';
    `);
  } catch {
    // Ignore if table doesn't exist yet
  }
}

export function seedInitialStoreData(db, secretHex) {
  const nowIso = new Date().toISOString();

  // Only ensure the default Admin (owner) account exists
  const insertUserStmt = db.prepare(`
    INSERT OR IGNORE INTO system_users (
      id, username, display_name, role, pin_salt, pin_hash, pin_cipher, avatar_color, is_active, employee_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, '', ?, ?)
  `);

  for (const acc of SEED_ROLE_ACCOUNTS) {
    const saltHex = deterministicSaltHex(`role-user:${acc.id}:${acc.password}`);
    const { hashHex } = hashPin(acc.password, saltHex);
    const cipher = encryptPasswordForAdmin(acc.password, secretHex);
    insertUserStmt.run(
      acc.id,
      acc.username,
      acc.display_name,
      acc.role,
      saltHex,
      hashHex,
      cipher,
      acc.avatar_color,
      nowIso,
      nowIso
    );
  }
}
