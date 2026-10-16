import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const python = fileURLToPath(new URL(process.platform === 'win32' ? '../.venv/Scripts/python.exe' : '../.venv/bin/python', import.meta.url));
if (!existsSync(python)) {
  console.error('Python 가상환경이 필요합니다. DEPENDENCIES.md의 OR-Tools 설치 방법을 확인하세요.');
  process.exit(1);
}
const server = spawn(python, [fileURLToPath(new URL('./optimizer-server.py', import.meta.url)), ...process.argv.slice(2)], { stdio: 'inherit', windowsHide: true });
server.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
server.on('exit', (code) => { process.exitCode = code ?? 1; });
