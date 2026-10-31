const { spawn } = require('node:child_process');
const path = require('node:path');
const { launchEnvironment } = require('./launch-env.cjs');
const executable = require('electron');
const child = spawn(executable, [path.resolve(__dirname, '..')], { stdio: 'inherit', env: launchEnvironment(executable) });
child.on('exit', code => process.exit(code || 0));
child.on('error', error => { console.error('StudyDesk 启动失败:', error.message); process.exitCode = 1; });
