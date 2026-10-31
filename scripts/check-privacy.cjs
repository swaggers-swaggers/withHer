const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const staged = process.argv.includes('--staged');
const git = args => execFileSync('git', ['-C', root, ...args], { maxBuffer: 64 * 1024 * 1024 });
const files = [...new Set(git(staged ? ['ls-files', '-z', '--cached'] : ['ls-files', '-z', '--cached', '--others', '--exclude-standard']).toString().split('\0').filter(Boolean))];
const roots = new Set(['app', 'electron', 'assets', 'public', 'companion', 'scripts', 'tests', 'docs', '.github']);
const rootFiles = new Set(['.gitignore', '.gitattributes', 'README.md', 'THIRD_PARTY_NOTICES.md', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'index.html', 'start-studydesk.sh']);
const docs = new Set(['WINDOWS.md', 'PRIVACY.md', 'ARCHITECTURE.md', 'ASSETS.md']);
const forbidden = /(?:^|\/)(?:node_modules|dist|release|logs|test-results|backups|archives|profiles?|user-?data|\.config|\.codex|\.agents|companion-prompts)(?:\/|$)|(?:^|\/)\.env(?:\.|$)|\.(?:sqlite[^/]*|db|enc|pem|key|p12|pfx|log|zip|7z|gz)$|(?:dafeyu-config|maibot-bridge|runtime-state)\.json$|studydesk-records-|完整请求|调用记录|完整历史|内容快照|生活日记/;
const patterns = [
  ['credential prefix', /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[A-Z0-9]{16})\b/],
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['literal authorization token', /["']?(?:Authorization)["']?\s*[:=]\s*["']Bearer\s+[A-Za-z0-9_.-]{16,}/i],
  ['literal secret assignment', /["']?(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)["']?\s*[:=]\s*["'][A-Za-z0-9+/_=.-]{20,}["']/i],
  ['personal home path', /(?:\/home\/|\/Users\/|[A-Za-z]:\\(?:Users|Documents and Settings)\\)[A-Za-z0-9_.-]+/],
  ['email address', /\b[A-Za-z0-9._%+-]+@(?!studydesk\.invalid\b|users\.noreply\.github\.com\b|example\.(?:com|org|net)\b)[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/],
];
const failures = [];
for (const name of files) {
  const parts = name.split('/');
  if ((!rootFiles.has(name) && !roots.has(parts[0])) || forbidden.test(name) ||
      (parts[0] === 'docs' && (parts.length !== 2 || !docs.has(parts[1])))) {
    failures.push([name, 'unreviewed or private file path']); continue;
  }
  const mode = git(['ls-files', '--stage', '--', name]).toString().slice(0, 6);
  const full = path.join(root, name);
  if (mode === '120000' || (!staged && fs.lstatSync(full).isSymbolicLink())) { failures.push([name, 'symbolic link']); continue; }
  const data = staged ? git(['show', ':' + name]) : fs.readFileSync(full);
  if (/\.(png|ico)$/.test(name)) {
    const png = data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const ico = data.subarray(0, 4).equals(Buffer.from([0,0,1,0]));
    if (!(name.endsWith('.png') ? png : ico)) failures.push([name, 'invalid image format']);
    for (let at = 8; png && at + 12 <= data.length;) {
      const length = data.readUInt32BE(at), type = data.toString('ascii', at + 4, at + 8);
      if (['tEXt', 'zTXt', 'iTXt', 'eXIf', 'caBX'].includes(type)) failures.push([name, 'image metadata requires review']);
      at += length + 12;
    }
    continue;
  }
  if (data.includes(0)) { failures.push([name, 'unexpected binary data']); continue; }
  const lines = data.toString('utf8').split('\n');
  for (const [label, regex] of patterns) {
    const index = lines.findIndex(line => regex.test(line));
    if (index >= 0) failures.push([name, `${label} at line ${index + 1}`]);
  }
}
if (failures.length) {
  // Never echo matching values; diagnostics contain filenames and rule names only.
  for (const [name, reason] of failures) console.error(`${name}: ${reason}`);
  process.exitCode = 1;
} else console.log(`Privacy checks passed for ${files.length} ${staged ? 'index' : 'publication'} files. Pattern checks do not replace manual review.`);
