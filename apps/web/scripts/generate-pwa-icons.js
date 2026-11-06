import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.resolve(__dirname, '..', 'public');
const logoJpegPath = path.join(publicDir, 'logo.jpeg');
const psScriptPath = path.join(__dirname, 'generate-pwa-from-logo.ps1');

if (!fs.existsSync(logoJpegPath)) {
  console.error('Error: public/logo.jpeg does not exist!');
  process.exit(1);
}

// On Windows, use PowerShell GDI+ for high-quality bicubic resampling of logo.jpeg
if (process.platform === 'win32' && fs.existsSync(psScriptPath)) {
  console.log('Generating PWA icons from public/logo.jpeg using PowerShell GDI+ high-quality bicubic resampling...');
  const res = spawnSync('powershell', ['-ExecutionPolicy', 'Bypass', '-File', psScriptPath], {
    stdio: 'inherit',
  });
  if (res.status === 0) {
    console.log('Successfully generated all PWA icons from logo.jpeg!');
    process.exit(0);
  }
}

console.log('Done.');
