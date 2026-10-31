import crypto from 'node:crypto';

export const ROLES_METADATA = {
  owner: {
    id: 'owner',
    label: 'الأدمن العام / المالك',
    shortLabel: 'الأدمن',
    icon: 'shield_locked',
    color: '#7627BB',
    description: 'صلاحية كاملة على النظام، المستخدمين، الصلاحيات، النسخ الاحتياطي، والإعدادات السحابية',
  },
  manager: {
    id: 'manager',
    label: 'مدير الفرع / المدير',
    shortLabel: 'المدير',
    icon: 'workspace_premium',
    color: '#9334E6',
    description: 'إدارة الفرع بالكامل، الموظفين، الموردين، النواقص، التقارير الشاملة، وتعديل السجلات',
  },
  supervisor: {
    id: 'supervisor',
    label: 'مشرف الصالة',
    shortLabel: 'مشرف الفرع',
    icon: 'manage_accounts',
    color: '#0B57D0',
    description: 'إدارة الموظفين والموردين، التقارير، إغلاق الملاحظات، ومراجعة التشغيل اليومي',
  },
  cctv: {
    id: 'cctv',
    label: 'مراقب الكاميرات',
    shortLabel: 'مراقب الكاميرات',
    icon: 'desktop_windows',
    color: '#185ABC',
    description: 'مطابقة حضور الموظفين بالكاميرا، تسجيل الملاحظات والوقائع، تسليم الوردية، ومتابعة الرصيف',
  },
  security: {
    id: 'security',
    label: 'الأمن واستلام البضاعة',
    shortLabel: 'الأمن',
    icon: 'shield_person',
    color: '#146C2E',
    description: 'تسجيل حضور وانصراف الموظفين، وعربيات الموردين والطلبيات، وملاحظات البوابة وتسليم وردية الأمن',
  },
  hall: {
    id: 'hall',
    label: 'عمال الصالة والممرات',
    shortLabel: 'عمال الصالة',
    icon: 'shopping_basket',
    color: '#007B83',
    description: 'تحديد الأصناف الناقصة في الصالة وتحديد أو تعديل الكميات المطلوبة وتسليم وردية الصالة',
  },
  kiosk: {
    id: 'kiosk',
    label: 'شاشة كشك العمال (مقيدة)',
    shortLabel: 'كشك العمال',
    icon: 'touch_app',
    color: '#E37400',
    description: 'وضع مقفول بأقل صلاحية لتسجيل حضور وانصراف العمال باللمس أو كرت الـ QR فقط دون عرض أي سجلات',
  },
};

export const ALL_PERMISSIONS = [
  { id: 'attendance:kiosk', label: 'تسجيل حضور كشك العمال / QR', group: 'الحضور والانصراف' },
  { id: 'attendance:read', label: 'عرض سجل الحضور التفصيلي', group: 'الحضور والانصراف' },
  { id: 'attendance:write', label: 'تسجيل حضور وانصراف واستراحات', group: 'الحضور والانصراف' },
  { id: 'attendance:verify', label: 'ختم مطابقة مراقب الكاميرات ✓', group: 'الحضور والانصراف' },
  { id: 'trucks:read', label: 'عرض سجل عربيات البضاعة', group: 'الموردون والطلبيات' },
  { id: 'trucks:write', label: 'تسجيل وصول وإنهاء استلام العربيات', group: 'الموردون والطلبيات' },
  { id: 'suppliers:clear_return', label: 'تسوية ومسح تنبيهات مرتجعات الموردين', group: 'الموردون والطلبيات' },
  { id: 'shortages:read', label: 'عرض قائمة نواقص الصالة', group: 'النواقص وأصناف الصالة' },
  { id: 'shortages:write', label: 'إضافة الأصناف الناقصة وتحديد/تعديل الكمية المطلوبة', group: 'النواقص وأصناف الصالة' },
  { id: 'shortages:manage', label: 'اعتماد توفير النواقص وتغيير الحالة وإدارة كتالوج الأصناف', group: 'النواقص وأصناف الصالة' },
  { id: 'notes:read', label: 'عرض سجل الملاحظات والوقائع', group: 'الملاحظات والورديات' },
  { id: 'notes:write', label: 'إضافة ملاحظات ووقائع جديدة', group: 'الملاحظات والورديات' },
  { id: 'notes:resolve', label: 'إغلاق وحل الملاحظات المعلقة', group: 'الملاحظات والورديات' },
  { id: 'handover:manage', label: 'تسليم واستلام الورديات', group: 'الملاحظات والورديات' },
  { id: 'reports:view', label: 'عرض لوحة التقارير الشاملة والسجل الزمني الموحد', group: 'الإدارة والأمان' },
  { id: 'reports:export', label: 'تصدير شيتات Excel وتقارير واتساب', group: 'الإدارة والأمان' },
  { id: 'records:manage', label: 'تعديل وحذف أي سجل تشغيلي (حضور، عربيات، نواقص، ملاحظات)', group: 'الإدارة والأمان' },
  { id: 'staff:manage', label: 'إضافة وتعديل وحذف الموظفين وكروت QR', group: 'الإدارة والأمان' },
  { id: 'suppliers:manage', label: 'إضافة وحذف الموردين الدائمين', group: 'الإدارة والأمان' },
  { id: 'audit:view', label: 'عرض سجل التدقيق الأمني (Audit Log)', group: 'الإدارة والأمان' },
  { id: 'settings:manage', label: 'تعديل إعدادات الفرع والمزامنة السحابية', group: 'الإدارة والأمان' },
  { id: 'backup:manage', label: 'تصدير واستعادة النسخ الاحتياطية الكاملة', group: 'الإدارة والأمان' },
  { id: 'users:manage', label: 'إدارة المستخدمين والأدوار ومصفوفة RBAC', group: 'الإدارة والأمان' },
];

export const DEFAULT_ROLE_PERMISSIONS = {
  owner: ALL_PERMISSIONS.map((p) => p.id),
  manager: [
    'attendance:kiosk',
    'attendance:read',
    'attendance:write',
    'attendance:verify',
    'trucks:read',
    'trucks:write',
    'suppliers:clear_return',
    'shortages:read',
    'shortages:write',
    'shortages:manage',
    'notes:read',
    'notes:write',
    'notes:resolve',
    'handover:manage',
    'reports:view',
    'reports:export',
    'records:manage',
    'staff:manage',
    'suppliers:manage',
    'audit:view',
    'settings:manage',
  ],
  supervisor: [
    'attendance:kiosk',
    'attendance:read',
    'attendance:write',
    'attendance:verify',
    'trucks:read',
    'trucks:write',
    'suppliers:clear_return',
    'shortages:read',
    'shortages:write',
    'shortages:manage',
    'notes:read',
    'notes:write',
    'notes:resolve',
    'handover:manage',
    'reports:view',
    'reports:export',
    'staff:manage',
    'suppliers:manage',
    'audit:view',
  ],
  cctv: [
    'attendance:kiosk',
    'attendance:read',
    'attendance:write',
    'attendance:verify',
    'trucks:read',
    'trucks:write',
    'suppliers:clear_return',
    'notes:read',
    'notes:write',
    'notes:resolve',
    'handover:manage',
    'reports:view',
    'reports:export',
  ],
  security: [
    'attendance:kiosk',
    'attendance:read',
    'attendance:write',
    'trucks:read',
    'trucks:write',
    'notes:read',
    'notes:write',
    'handover:manage',
  ],
  hall: ['shortages:read', 'shortages:write', 'handover:manage'],
  kiosk: ['attendance:kiosk'],
};

export function normalizeDigits(str = '') {
  return String(str).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
}

export function normalizeRequestedQty(raw) {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  const str = normalizeDigits(String(raw)).trim().replace(/[٫,]/g, '.');
  if (str === '') return { ok: true, value: null };
  const num = Number(str);
  if (!Number.isFinite(num) || num < 0) {
    return {
      ok: false,
      error: 'الكمية المطلوبة يجب أن تكون رقماً (0 أو أكثر) أو تُترك فارغة',
    };
  }
  return { ok: true, value: num };
}

export function hashPin(pin, existingSaltHex) {
  const saltHex = existingSaltHex || crypto.randomBytes(16).toString('hex');
  const derivedHex = crypto
    .scryptSync(String(pin).trim(), Buffer.from(saltHex, 'hex'), 64)
    .toString('hex');
  return { saltHex, hashHex: derivedHex };
}

export function verifyPinHash(pin, saltHex, expectedHashHex) {
  if (!pin || !saltHex || !expectedHashHex) return false;
  try {
    const actualHex = crypto
      .scryptSync(String(pin).trim(), Buffer.from(saltHex, 'hex'), 64)
      .toString('hex');
    const a = Buffer.from(actualHex, 'hex');
    const b = Buffer.from(expectedHashHex, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function encryptPasswordForAdmin(plainPassword, secretHex) {
  if (!plainPassword || !secretHex) return '';
  try {
    const key = crypto
      .createHash('sha256')
      .update(Buffer.from(secretHex, 'hex'))
      .digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([
      cipher.update(String(plainPassword).trim(), 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
  } catch {
    return '';
  }
}

export function decryptPasswordForAdmin(cipherText, secretHex) {
  if (!cipherText || !secretHex || !cipherText.includes(':')) return '';
  try {
    const [ivHex, tagHex, encHex] = cipherText.split(':');
    const key = crypto
      .createHash('sha256')
      .update(Buffer.from(secretHex, 'hex'))
      .digest();
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(ivHex, 'hex')
    );
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch {
    return '';
  }
}

export function signSessionToken(sessionId, secretHex) {
  const sig = crypto
    .createHmac('sha256', Buffer.from(secretHex, 'hex'))
    .update(sessionId)
    .digest('hex');
  return `${sessionId}.${sig}`;
}

export function verifySignedTokenFormat(rawToken, secretHex) {
  if (!rawToken || typeof rawToken !== 'string' || !rawToken.includes('.')) return null;
  const [sessionId, sigHex] = rawToken.split('.');
  if (!sessionId || !sigHex) return null;
  try {
    const expectedHex = crypto
      .createHmac('sha256', Buffer.from(secretHex, 'hex'))
      .update(sessionId)
      .digest('hex');
    const a = Buffer.from(sigHex, 'hex');
    const b = Buffer.from(expectedHex, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    return sessionId;
  } catch {
    return null;
  }
}

export function validateImageMagicBytes(buffer, ext) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return false;
  if (buffer.length > 8 * 1024 * 1024) return false; // 8MB max binary size
  if (ext === 'jpg') {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }
  if (ext === 'png') {
    return (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    );
  }
  if (ext === 'webp') {
    const riff = buffer.subarray(0, 4).toString('ascii');
    const webp = buffer.subarray(8, 12).toString('ascii');
    return riff === 'RIFF' && webp === 'WEBP';
  }
  return false;
}

export function createLoginRateLimiter({ maxAttempts = 5, windowMs = 180000, blockMs = 60000 } = {}) {
  const attempts = new Map();

  function getKey(ip, targetId = 'any') {
    return `${ip || 'unknown'}:${targetId}`;
  }

  return {
    checkBlocked(ip, targetId) {
      const key = getKey(ip, targetId);
      const entry = attempts.get(key);
      if (!entry) return { blocked: false, retryAfterSec: 0 };
      const now = Date.now();
      if (entry.blockedUntil && entry.blockedUntil > now) {
        return {
          blocked: true,
          retryAfterSec: Math.ceil((entry.blockedUntil - now) / 1000),
        };
      }
      if (now - entry.firstAt > windowMs) {
        attempts.delete(key);
      }
      return { blocked: false, retryAfterSec: 0 };
    },

    recordFailure(ip, targetId) {
      const key = getKey(ip, targetId);
      const now = Date.now();
      const entry = attempts.get(key);
      if (!entry || now - entry.firstAt > windowMs) {
        attempts.set(key, { count: 1, firstAt: now, blockedUntil: 0 });
        return { lockedNow: false, remaining: maxAttempts - 1 };
      }
      entry.count += 1;
      if (entry.count >= maxAttempts) {
        entry.blockedUntil = now + blockMs;
        return { lockedNow: true, remaining: 0 };
      }
      return { lockedNow: false, remaining: maxAttempts - entry.count };
    },

    reset(ip, targetId) {
      attempts.delete(getKey(ip, targetId));
    },
  };
}

export function getRolePermissions(db, role) {
  if (role === 'owner') {
    return ALL_PERMISSIONS.map((p) => p.id);
  }
  const row = db
    .prepare('SELECT permissions_json FROM role_policies WHERE role = ?')
    .get(role);
  if (row?.permissions_json) {
    try {
      return JSON.parse(row.permissions_json);
    } catch {
      // fallback
    }
  }
  return DEFAULT_ROLE_PERMISSIONS[role] || [];
}

export function recordAuditLog(db, { userId = '', userName = 'النظام', role = '', action, details = '', ip = '', severity = 'info' }) {
  try {
    db.prepare(`
      INSERT INTO audit_logs (id, user_id, user_name, role, action, details, ip_address, severity, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      crypto.randomUUID(),
      userId,
      userName,
      role,
      action,
      details,
      ip,
      severity,
      new Date().toISOString()
    );
  } catch {
    // Non-fatal
  }
}

export function securityHeadersMiddleware(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '0');
  next();
}
