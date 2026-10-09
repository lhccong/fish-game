import { spawn } from 'node:child_process';
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { loadRoomApp } from './room-app.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appsDir = path.join(rootDir, 'apps');
const roomsDir = path.join(appsDir, 'web', 'public', 'rooms');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(npm, args, { cwd: rootDir, stdio: 'inherit', shell: true, ...options });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`npm ${args.join(' ')} exited with ${signal ? `signal ${signal}` : `code ${code ?? 1}`}`));
    });
  });
}

try {
  const entries = await readdir(appsDir, { withFileTypes: true });
  const roomNames = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('room-'))
    .map((entry) => entry.name)
    .sort();

  const previousOutputs = await readdir(roomsDir, { withFileTypes: true });
  await Promise.all(previousOutputs
    .filter((entry) => entry.name.startsWith('room-'))
    .map((entry) => rm(path.join(roomsDir, entry.name), { recursive: true, force: true })));

  for (const roomName of roomNames) {
    const room = await loadRoomApp(rootDir, roomName, 'build:room');
    const outputDir = path.join(roomsDir, room.outputName);
    await rm(outputDir, { recursive: true, force: true });
    console.log(`[room:build] ${roomName} -> ${path.relative(rootDir, outputDir)}`);
    await run(['run', 'build:room'], {
      cwd: room.appDir,
      env: { ...process.env, PARTI_ROOM_BUILD_OUT_DIR: outputDir },
    });
  }

  await run(['run', 'build', '--workspace=@parti/web']);
} catch (error) {
  console.error(`[room:build] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
