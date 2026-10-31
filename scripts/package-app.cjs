const { spawnSync } = require('node:child_process');
const path = require('node:path');

// Use Node directly so Windows does not need bash or npm.cmd shell quoting.
const root = path.resolve(__dirname, '..');
const target = process.argv[2] || 'dir';
if (!['dir', 'win'].includes(target)) throw new Error('支持的目标：dir、win');
if (target === 'win' && process.platform !== 'win32') {
  throw new Error('请在 Windows 上运行 package:win，或使用仓库的 Windows 构建工作流。');
}
if (!['linux', 'win32'].includes(process.platform)) throw new Error('当前打包脚本支持 Linux 和 Windows。');
// Electron 42+ installs its binary lazily. Resolve it before using electronDist.
require('electron');
const args = target === 'win' ? ['--win', 'nsis', 'portable', '--x64'] : [process.platform === 'win32' ? '--win' : '--linux', 'dir'];
const result = spawnSync(process.execPath, [require.resolve('electron-builder/cli.js'), ...args, '--publish', 'never'], {
  cwd: root, stdio: 'inherit', env: process.env,
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
if (process.platform === 'linux') {
  const prepared = spawnSync('bash', [path.join(__dirname, 'prepare-sandbox.sh'), path.join(root, 'release/linux-unpacked/studydesk')], { stdio: 'inherit' });
  if (prepared.error) throw prepared.error;
  if (prepared.status !== 0) process.exit(prepared.status || 1);
}
