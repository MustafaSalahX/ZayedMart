import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AttendanceModule } from './attendance/attendance.module';
import { AuthModule } from './auth/auth.module';
import { BootstrapModule } from './bootstrap/bootstrap.module';
import { ChatModule } from './chat/chat.module';
import { AuthGuard } from './common/guards/auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { DatabaseModule } from './database/database.module';
import { EmployeesModule } from './employees/employees.module';
import { NotesModule } from './notes/notes.module';
import { RbacModule } from './rbac/rbac.module';
import { RealtimeModule } from './realtime/realtime.module';
import { ShortagesModule } from './shortages/shortages.module';
import { TrucksModule } from './trucks/trucks.module';
import { WalkieModule } from './walkie/walkie.module';

@Module({
  imports: [
    DatabaseModule,
    RealtimeModule,
    AuthModule,
    BootstrapModule,
    RbacModule,
    EmployeesModule,
    AttendanceModule,
    TrucksModule,
    ShortagesModule,
    NotesModule,
    ChatModule,
    WalkieModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: PermissionsGuard,
    },
  ],
})
export class AppModule {}
