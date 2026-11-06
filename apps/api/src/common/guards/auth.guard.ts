import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { extractBearerOrQueryToken } from '../crypto.util';
import { IS_PUBLIC_KEY } from '../decorators';
import { DatabaseService } from '../../database/database.service';

@Injectable()
export class AuthGuard implements CanActivate {
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

    const req = context.switchToHttp().getRequest<Request & { auth?: any }>();
    const res = context.switchToHttp().getResponse<Response>();

    const rawToken = extractBearerOrQueryToken(req);
    const auth = await this.db.resolveAuthFromToken(rawToken);
    if (!auth) {
      res.status(401).json({
        ok: false,
        code: 'UNAUTHENTICATED',
        error: 'انتهت الجلسة أو يلزم تسجيل الدخول أولاً',
      });
      return false;
    }

    req.auth = auth;
    return true;
  }
}
