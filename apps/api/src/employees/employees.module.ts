import {
  Body,
  Controller,
  Delete,
  Get,
  Module,
  Param,
  Post,
  Put,
  Req,
  Res,
} from '@nestjs/common';
import {
  inferDefaultRoleFromDepartment,
  normalizeDigits,
  ROLES_METADATA,
} from '@zayed-mart/shared';
import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { decryptPasswordForAdmin, getClientIp } from '../common/crypto.util';
import { AuthContext, CurrentAuth, RequirePermission } from '../common/decorators';
import { DatabaseService } from '../database/database.service';
import { RealtimeService } from '../realtime/realtime.service';

@Controller('api/employees')
export class EmployeesController {
  constructor(
    private readonly db: DatabaseService,
    private readonly realtime: RealtimeService
  ) {}

  @Post()
  @RequirePermission('staff:manage')
  async createEmployee(
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      const {
        emp_code,
        name,
        department = 'منسقي ممرات',
        role_title = '',
        system_role = '',
        login_password = '',
        login_enabled = 1,
        shift_start = '08:00',
        shift_end = '20:00',
        avatar_color = '#1A73E8',
        phone = '',
      } = body || {};

      if (!name || !String(name).trim()) {
        return res.status(400).json({ error: 'اسم الموظف مطلوب' });
      }

      const id = body?.id ? String(body.id) : crypto.randomUUID();
      const existingById = await this.db.queryOne<any>(
        'SELECT * FROM employees WHERE id = ?',
        [id]
      );
      if (existingById && Number(existingById.is_active) === 1) {
        return res.status(200).json({ ok: true, employee: existingById });
      }

      const rawCustomPass = normalizeDigits(String(login_password || '').trim());
      const cleanCode = normalizeDigits(String(emp_code || '').trim());
      const code = cleanCode || rawCustomPass || (await this.db.generateNextEmpCode());
      const effectivePass = rawCustomPass || code;

      const resolvedRole =
        system_role && (ROLES_METADATA[system_role] || system_role === 'none')
          ? system_role
          : inferDefaultRoleFromDepartment(department, role_title);

      if (login_enabled && resolvedRole !== 'none' && effectivePass) {
        const conflict = await this.db.findPasswordConflict(effectivePass);
        if (conflict) {
          return res.status(400).json({
            error: `الكود / كلمة المرور (${effectivePass}) مستخدم بالفعل لحساب "${conflict.display_name}" — يرجى اختيار كود/باسورد مختلف للموظف`,
          });
        }
      }

      const now = new Date().toISOString();
      await this.db.execute(
        `INSERT INTO employees (
          id, emp_code, name, department, role_title, system_role, login_enabled, shift_start, shift_end, avatar_color, phone, is_active, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT (id) DO UPDATE SET
          emp_code = EXCLUDED.emp_code,
          name = EXCLUDED.name,
          department = EXCLUDED.department,
          role_title = EXCLUDED.role_title,
          system_role = EXCLUDED.system_role,
          login_enabled = EXCLUDED.login_enabled,
          shift_start = EXCLUDED.shift_start,
          shift_end = EXCLUDED.shift_end,
          avatar_color = EXCLUDED.avatar_color,
          phone = EXCLUDED.phone,
          is_active = 1,
          updated_at = EXCLUDED.updated_at`,
        [
          id,
          code,
          String(name).trim(),
          department,
          role_title,
          resolvedRole,
          login_enabled ? 1 : 0,
          shift_start,
          shift_end,
          avatar_color,
          phone,
          now,
        ]
      );

      const created = await this.db.queryOne<any>('SELECT * FROM employees WHERE id = ?', [id]);
      await this.db.syncEmployeeLoginAccount(created, {
        system_role: resolvedRole,
        login_enabled: login_enabled ? 1 : 0,
        password: effectivePass,
        updatePassword: true,
      });

      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: 'إضافة موظف جديد',
        details: `إضافة الموظف "${String(name).trim()}" (${department}) بكود/باسورد #${effectivePass} وصلاحية (${ROLES_METADATA[resolvedRole]?.shortLabel || resolvedRole})`,
        ip: getClientIp(req),
      });

      await this.realtime.broadcastStoreUpdate('employee_add');
      return res.status(201).json({ ok: true, employee: created });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Post('bulk')
  @RequirePermission('staff:manage')
  async bulkCreateEmployees(
    @Body() body: any,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      const {
        lines = [],
        department = 'منسقي ممرات',
        system_role = '',
        shift_start = '08:00',
        shift_end = '20:00',
        avatar_color = '#0B57D0',
      } = body || {};

      const cleanLines = (Array.isArray(lines) ? lines : String(lines || '').split('\n'))
        .map((l) => String(l || '').trim())
        .filter(Boolean);

      if (cleanLines.length === 0) {
        return res.status(400).json({ error: 'يرجى كتابة اسم موظف واحد على الأقل' });
      }

      const now = new Date().toISOString();
      let nextCodeNum = parseInt(await this.db.generateNextEmpCode(), 10) || 101;
      let addedCount = 0;
      const createdIds: string[] = [];

      await this.db.withTransaction(async (client) => {
        for (const rawLine of cleanLines) {
          const parts = rawLine.split(/[-–|،,]/).map((p: string) => p.trim());
          const name = parts[0];
          if (!name) continue;
          const roleTitle = parts[1] || '';
          const phone = parts[2] || '';
          const resolvedRole =
            system_role && (ROLES_METADATA[system_role] || system_role === 'none')
              ? system_role
              : inferDefaultRoleFromDepartment(department, roleTitle);

          let candidateCode = String(nextCodeNum++);
          while (await this.db.findPasswordConflict(candidateCode)) {
            candidateCode = String(nextCodeNum++);
          }
          const empId = crypto.randomUUID();
          await this.db.execute(
            `INSERT INTO employees (
              id, emp_code, name, department, role_title, system_role, login_enabled, shift_start, shift_end, avatar_color, phone, is_active, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 1, ?)`,
            [
              empId,
              candidateCode,
              name,
              department,
              roleTitle,
              resolvedRole,
              shift_start,
              shift_end,
              avatar_color,
              phone,
              now,
            ],
            client
          );
          createdIds.push(empId);
          addedCount += 1;
        }
      });

      for (const empId of createdIds) {
        const empRow = await this.db.queryOne('SELECT * FROM employees WHERE id = ?', [empId]);
        if (empRow) await this.db.syncEmployeeLoginAccount(empRow);
      }

      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: 'إضافة جماعية للموظفين',
        details: `إضافة (${addedCount}) موظف في قسم (${department})`,
        ip: getClientIp(req),
      });

      await this.realtime.broadcastStoreUpdate('employee_bulk_add');
      return res.status(201).json({ ok: true, addedCount });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Put(':id')
  @RequirePermission('staff:manage')
  async updateEmployee(
    @Param('id') id: string,
    @Body() body: any,
    @Res() res: Response
  ) {
    try {
      const existing = await this.db.queryOne<any>('SELECT * FROM employees WHERE id = ?', [
        id,
      ]);
      if (!existing) return res.status(404).json({ error: 'الموظف غير موجود' });

      const {
        emp_code = existing.emp_code,
        name = existing.name,
        department = existing.department,
        role_title = existing.role_title,
        system_role = existing.system_role,
        login_password = '',
        login_enabled = existing.login_enabled ?? 1,
        shift_start = existing.shift_start,
        shift_end = existing.shift_end,
        avatar_color = existing.avatar_color,
        phone = existing.phone,
      } = body || {};

      const cleanCode = normalizeDigits(String(emp_code || existing.emp_code).trim());
      const rawCustomPass = normalizeDigits(String(login_password || '').trim());
      const effectivePass = rawCustomPass || cleanCode;

      const resolvedRole =
        system_role && (ROLES_METADATA[system_role] || system_role === 'none')
          ? system_role
          : inferDefaultRoleFromDepartment(department, role_title);

      const linkedUser = await this.db.queryOne<{ id: string }>(
        'SELECT id FROM system_users WHERE employee_id = ? LIMIT 1',
        [existing.id]
      );

      const passwordChanged =
        Boolean(rawCustomPass) || cleanCode !== String(existing.emp_code || '').trim();

      if (login_enabled && resolvedRole !== 'none' && passwordChanged && effectivePass) {
        const conflict = await this.db.findPasswordConflict(
          effectivePass,
          linkedUser?.id || ''
        );
        if (conflict) {
          return res.status(400).json({
            error: `الكود / كلمة المرور (${effectivePass}) مستخدم بالفعل لحساب "${conflict.display_name}" — اختر رقماً مختلفاً`,
          });
        }
      }

      await this.db.execute(
        `UPDATE employees
         SET emp_code = ?, name = ?, department = ?, role_title = ?, system_role = ?, login_enabled = ?, shift_start = ?, shift_end = ?, avatar_color = ?, phone = ?, updated_at = ?
         WHERE id = ?`,
        [
          cleanCode,
          String(name).trim(),
          department,
          role_title,
          resolvedRole,
          login_enabled ? 1 : 0,
          shift_start,
          shift_end,
          avatar_color,
          phone,
          new Date().toISOString(),
          existing.id,
        ]
      );

      const updatedEmp = await this.db.queryOne('SELECT * FROM employees WHERE id = ?', [
        existing.id,
      ]);
      await this.db.syncEmployeeLoginAccount(updatedEmp, {
        system_role: resolvedRole,
        login_enabled: login_enabled ? 1 : 0,
        password: effectivePass,
        updatePassword: passwordChanged,
      });

      await this.realtime.broadcastStoreUpdate('employee_edit');
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }

  @Delete(':id')
  @RequirePermission('staff:manage')
  async deleteEmployee(
    @Param('id') id: string,
    @CurrentAuth() auth: AuthContext,
    @Req() req: Request,
    @Res() res: Response
  ) {
    try {
      const existing = await this.db.queryOne<any>('SELECT * FROM employees WHERE id = ?', [
        id,
      ]);
      const nowIso = new Date().toISOString();
      await this.db.execute(
        'UPDATE employees SET is_active = 0, updated_at = ? WHERE id = ?',
        [nowIso, id]
      );
      if (existing) {
        await this.db.syncEmployeeLoginAccount({ ...existing, is_active: 0 });
      }
      await this.db.recordAuditLog({
        userId: auth.user.id,
        userName: auth.user.display_name,
        role: auth.user.role,
        action: 'أرشفة/حذف موظف',
        details: `حذف الموظف "${existing?.name || id}" من القائمة النشطة`,
        ip: getClientIp(req),
        severity: 'warning',
      });
      await this.realtime.broadcastStoreUpdate('employee_delete');
      return res.json({ ok: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  }
}

@Module({
  controllers: [EmployeesController],
})
export class EmployeesModule {}
