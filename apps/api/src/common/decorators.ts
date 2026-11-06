import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';

export interface AuthContext {
  sessionId: string;
  user: {
    id: string;
    username: string;
    display_name: string;
    role: string;
    role_label: string;
    avatar_color: string;
    employee_id?: string;
  };
  permissions: string[];
  actorLabel: string;
  has(perm: string): boolean;
}

export const IS_PUBLIC_KEY = 'isPublic';
export const PERMISSIONS_KEY = 'requiredPermissions';
export const ANY_PERMISSIONS_KEY = 'requiredAnyPermissions';

export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
export const RequirePermission = (perm: string) => SetMetadata(PERMISSIONS_KEY, [perm]);
export const RequireAnyPermission = (perms: string[]) => SetMetadata(ANY_PERMISSIONS_KEY, perms);

export const CurrentAuth = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthContext => {
    const request = ctx.switchToHttp().getRequest();
    return request.auth;
  }
);
