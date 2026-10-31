const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const home = os.homedir();
const data = process.env.XDG_DATA_HOME || path.join(home, '.local/share');
const apps = path.join(data, 'applications');
const desktopDir = execFileSync('xdg-user-dir', ['DESKTOP'], { encoding: 'utf8' }).trim();
const id = 'local.studydesk.app.desktop';
const icon = path.join(data, 'icons/hicolor/512x512/apps/local.studydesk.app-v2.png');
const backupDir = path.join(root, 'backups', 'desktop-entries-' + Date.now());
execFileSync('bash', [path.join(__dirname, 'prepare-sandbox.sh'), path.join(root, 'release/linux-unpacked/studydesk')]);
function atomicFile(filename, data, mode) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  const tmp = filename + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, data, { mode });
  fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, filename);
}
// 使用新的 desktop id 与图标路径，避免旧 Shell.App 对象和旧图标缓存。
atomicFile(icon, fs.readFileSync(path.join(root, 'assets/studydesk-icon.png')), 0o644);
const quoteExec = value => '"' + value.replace(/["`$\\]/g, '\\$&') + '"';
const shortcut = `[Desktop Entry]\nVersion=1.0\nType=Application\nName=StudyDesk\nComment=待办、学习计时、统计与日历\nExec=${quoteExec(path.join(root, 'start-studydesk.sh'))}\nTryExec=${path.join(root, 'start-studydesk.sh')}\nIcon=${icon}\nTerminal=false\nCategories=Education;\nStartupWMClass=StudyDesk\nStartupNotify=true\n`;
for (const old of [path.join(apps, 'studydesk.desktop'), path.join(desktopDir, '知时 StudyDesk.desktop')]) {
  if (!fs.existsSync(old)) continue;
  fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
  fs.renameSync(old, path.join(backupDir, path.basename(path.dirname(old)) + '-' + path.basename(old)));
}
const applicationFile = path.join(apps, id);
const desktopFile = path.join(desktopDir, 'StudyDesk.desktop');
atomicFile(applicationFile, shortcut, 0o644);
atomicFile(desktopFile, shortcut, 0o755);
execFileSync('desktop-file-validate', [applicationFile, desktopFile]);
execFileSync('update-desktop-database', [apps]);
const trusted = spawnSync('gio', ['set', desktopFile, 'metadata::trusted', 'true'], { encoding: 'utf8' });
if (trusted.status !== 0) console.warn(trusted.stderr.trim());
spawnSync('gtk-update-icon-cache', ['-f', '-t', path.join(data, 'icons/hicolor')]);
const manifest = { id, applicationFile, desktopFile, icon, installedAt: new Date().toISOString(), desktopTrusted: trusted.status === 0 };
atomicFile(path.join(root, 'release/local-installation.json'), JSON.stringify(manifest, null, 2), 0o644);
console.log(JSON.stringify(manifest, null, 2));
