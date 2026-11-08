import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(webDir, '../..');
const androidDir = path.join(webDir, 'android');

function findJavaHome() {
  const isWin = process.platform === 'win32';
  const javacBin = isWin ? 'javac.exe' : 'javac';
  const jlinkBin = isWin ? 'jlink.exe' : 'jlink';

  const hasFullJdk = (dir) =>
    Boolean(
      dir &&
        fs.existsSync(path.join(dir, 'bin', javacBin)) &&
        fs.existsSync(path.join(dir, 'bin', jlinkBin))
    );

  if (hasFullJdk(process.env.JAVA_HOME)) {
    return process.env.JAVA_HOME;
  }

  const home = os.homedir();
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const portableJdk = path.join(localAppData, 'Programs', 'jdk-21');
  if (hasFullJdk(portableJdk)) {
    return portableJdk;
  }

  const extDir = path.join(home, '.antigravity', 'extensions');
  if (fs.existsSync(extDir)) {
    for (const entry of fs.readdirSync(extDir)) {
      if (entry.startsWith('redhat.java-')) {
        const jreRoot = path.join(extDir, entry, 'jre');
        if (fs.existsSync(jreRoot)) {
          for (const sub of fs.readdirSync(jreRoot)) {
            const candidate = path.join(jreRoot, sub);
            if (fs.existsSync(path.join(candidate, 'bin', javacBin))) {
              return candidate;
            }
          }
        }
      }
    }
  }

  return process.env.JAVA_HOME || '';
}

function findAndroidHome() {
  if (process.env.ANDROID_HOME && fs.existsSync(process.env.ANDROID_HOME)) {
    return process.env.ANDROID_HOME;
  }
  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const candidate = path.join(localAppData, 'Android', 'Sdk');
  if (fs.existsSync(candidate)) {
    return candidate;
  }
  return process.env.ANDROID_HOME || '';
}

const javaHome = findJavaHome();
const androidHome = findAndroidHome();

if (!javaHome) {
  console.error('Error: Could not find a valid JDK (javac). Set JAVA_HOME first.');
  process.exit(1);
}

console.log('Using JAVA_HOME:', javaHome);
if (androidHome) {
  console.log('Using ANDROID_HOME:', androidHome);
}

const env = {
  ...process.env,
  JAVA_HOME: javaHome,
  ANDROID_HOME: androidHome || process.env.ANDROID_HOME,
  ANDROID_SDK_ROOT: androidHome || process.env.ANDROID_SDK_ROOT,
  PATH: `${path.join(javaHome, 'bin')}${path.delimiter}${process.env.PATH || ''}`,
};

console.log('1) Syncing web bundle into Capacitor Android project...');
const syncRes = spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['cap', 'sync', 'android'], {
  cwd: webDir,
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (syncRes.status !== 0) {
  process.exit(syncRes.status || 1);
}

console.log('2) Building Universal Android APK via Gradle...');
const gradleCmd = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const gradleRes = spawnSync(gradleCmd, ['assembleDebug', '--no-daemon'], {
  cwd: androidDir,
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (gradleRes.status !== 0) {
  process.exit(gradleRes.status || 1);
}

const apkSource = path.join(androidDir, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
if (!fs.existsSync(apkSource)) {
  console.error('Error: Expected APK output not found at:', apkSource);
  process.exit(1);
}

const rootApkDest = path.join(rootDir, 'zayed-mart-ops.apk');
const publicApkDest = path.join(webDir, 'public', 'zayed-mart.apk');

fs.copyFileSync(apkSource, rootApkDest);
fs.copyFileSync(apkSource, publicApkDest);

const sizeMb = (fs.statSync(rootApkDest).size / (1024 * 1024)).toFixed(2);
console.log(`\n✓ Successfully built Zayed Mart Android APK (${sizeMb} MB):`);
console.log(`  - Root APK:   ${rootApkDest}`);
console.log(`  - Public APK: ${publicApkDest}`);
