const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
function validHelper(filename) {
  try { const info = fs.statSync(filename); return info.isFile() && info.uid === 0 && (info.mode & 0o7777) === 0o4755; }
  catch { return false; }
}
function launchEnvironment(executable, original = process.env) {
  const env = { ...original };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.CHROME_DEVEL_SANDBOX;
  if (process.platform === 'linux') {
    const helper = execFileSync('bash', [path.join(__dirname, 'prepare-sandbox.sh'), executable], { encoding: 'utf8' }).trim();
    if (!helper) throw new Error('未找到配置正确的启动组件。请安装 studydesk 的 deb 包后再运行。');
    if (!validHelper(helper)) throw new Error('启动组件权限不正确。');
  }
  return env;
}
module.exports = { validHelper, launchEnvironment };
