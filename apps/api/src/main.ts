import { createZayedNestApp } from './app.factory';
import { DatabaseService } from './database/database.service';

async function bootstrap() {
  const port = Number(process.env.PORT || 3001);
  const app = await createZayedNestApp({ serveSpa: true });
  const db = app.get(DatabaseService);
  await app.listen(port, '0.0.0.0');
  console.log(
    `[ZayedMart NestJS] Server listening on http://localhost:${port} (storageMode=${db.storageMode})`
  );
}

bootstrap().catch((err) => {
  console.error('[ZayedMart NestJS] Fatal startup error:', err);
  process.exit(1);
});
