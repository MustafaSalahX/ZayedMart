import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { getClientIp } from '../crypto.util';
import { ANY_PERMISSIONS_KEY, AuthContext, IS_PUBLIC_KEY, PERMISSIONS_KEY } from '../decorators';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DatabaseService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const requiredAll = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredAny = this.reflector.getAllAndOverride<string[]>(ANY_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if ((!requiredAll || requiredAll.length === 0) && (!requiredAny || requiredAny.length === 0)) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request & { auth?: AuthContext }>();
    const res = context.switchToHttp().getResponse<Response>();
    const auth = req.auth;

    if (!auth) {
      res.status(401).json({ ok: false, error: 'يلزم تسجيل الدخول' });
      return false;
    }

    if (requiredAll && requiredAll.length > 0) {
      const missing = requiredAll.find((p) => !auth.has(p));
      if (missing) {
        await this.db.recordAuditLog({
          userId: auth.user.id,
          userName: auth.user.display_name,
          role: auth.user.role,
          action: 'رفض صلاحية RBAC',
          details: `محاولة تنفيذ إجراء يتطلب صلاحية (${missing}) على المسار ${req.method} ${req.path}`,
          ip: getClientIp(req),
          severity: 'warning',
        });
        res.status(403).json({
          ok: false,
          code: 'FORBIDDEN',
          error: `عفواً، دورك الحالي (${auth.user.role_label}) لا يملك صلاحية تنفيذ هذا الإجراء.`,
        });
        return false;
      }
    }

    if (requiredAny && requiredAny.length > 0) {
      const ok = requiredAny.some((p) => auth.has(p));
      if (!ok) {
        res.status(403).json({
          ok: false,
          code: 'FORBIDDEN',
          error: `عفواً، دورك الحالي (${auth.user.role_label}) غير مصرح له بهذا الإجراء.`,
        });
        return false;
      }
    }

    return true;
  }
}
