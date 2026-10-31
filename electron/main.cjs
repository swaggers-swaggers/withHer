const { app, BrowserWindow, ipcMain, protocol, net, session, powerMonitor, Notification, dialog, globalShortcut, Menu, Tray, nativeImage, safeStorage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { StudyStore, dayKey } = require('./store.cjs');
const { CredentialVault } = require('./credential-vault.cjs');
const { DafeyuEngine } = require('./dafeyu-engine.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'studydesk', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
const preservedDataDir = process.env.STUDYDESK_DATA_DIR || path.join(app.getPath('appData'), 'StudyDesk');
fs.mkdirSync(preservedDataDir, { recursive: true, mode: 0o700 });
app.setPath('userData', path.resolve(preservedDataDir));
app.setName('StudyDesk');
if (process.platform === 'win32') app.setAppUserModelId('local.studydesk.app');
let win = null, store = null, companion = null, interval = null, tray = null, quitting = false, backup = () => {};
let screenLocked=false,suspended=false;
let lastChatPopup = 0;
const notifications = new Set();
const iconPath = path.join(app.getAppPath(), 'assets/studydesk-icon.png');
const avatarPath = path.join(app.getAppPath(), 'assets/dafeyu-avatar.png');
let runtime = { pid: process.pid, version: app.getVersion(), running: true, windowReady: false };
function runtimeStatus(patch) {
  runtime = { ...runtime, ...patch, updatedAt: Date.now() };
  try {
    const file = path.join(app.getPath('userData'), 'runtime-state.json');
    fs.writeFileSync(file + '.tmp', JSON.stringify(runtime), { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
  } catch (error) { console.error('Runtime status:', error.message); }
}

function send(channel, payload) {
  if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send(channel, payload);
}
function pause(message) {
  if (store?.timer.status === 'running') {
    store.dispatch('timer.pause', { message });
    send('desk:tick', { timer: store.timer, revision: store.revision, reload: true });
  }
}
function createWindow() {
  if (win && !win.isDestroyed()) return win;
  const created = new BrowserWindow({ width: 1360, height: 940, minWidth: 720, minHeight: 620,
    title: 'StudyDesk', backgroundColor: '#fcfcfe', icon: iconPath, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true,
      nodeIntegration: false, sandbox: true, spellcheck: false } });
  win = created;
  created.on('show', () => runtimeStatus({ windowVisible: true }));
  created.on('hide', () => runtimeStatus({ windowVisible: false }));
  created.webContents.once('did-finish-load', async () => {
    try {
      const state = await created.webContents.executeJavaScript(`new Promise(resolve => {
        let attempts = 0;
        const check = () => {
          const modules = !!document.querySelector('.home-page');
          if (modules || ++attempts >= 100) resolve({
            rendererSandboxed: window.studyDesk?.runtime?.sandboxed === true,
            contextIsolated: window.studyDesk?.runtime?.contextIsolated === true,
            hasMainModules: modules, title: document.title
          });
          else setTimeout(check, 25);
        };
        check();
      })`);
      runtimeStatus({ ...state, windowReady: true, windowVisible: created.isVisible(), sandboxDisabled: process.argv.includes('--no-sandbox') });
    } catch (error) { console.error('Window startup status:', error.message); }
  });
  created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  created.webContents.on('will-navigate', (event, url) => { if (url !== 'studydesk://app/index.html') event.preventDefault(); });
  created.on('close', event => {
    if (quitting) return;
    event.preventDefault();
    try { pause('窗口关闭时已暂停计时'); } catch (error) { console.error('Pause on close:', error); }
    created.hide();
  });
  created.on('closed', () => { if (win === created) { win = null; runtimeStatus({ windowReady: false, windowVisible: false }); } });
  created.loadURL('studydesk://app/index.html').catch(error => console.error('Load window:', error));
  return created;
}
function showWindow(quickAdd = false) {
  if (!app.isReady() || !store) return;
  const current = createWindow();
  if (current.isMinimized()) current.restore();
  current.show(); current.focus();
  if (quickAdd) {
    if (current.webContents.isLoading()) current.webContents.once('did-finish-load', () => send('desk:quick-add'));
    else send('desk:quick-add');
  }
}
function nativeNotification(title, body, onClick = () => showWindow(), notificationIcon = iconPath) {
  if (!Notification.isSupported()) return false;
  try {
    const notification = new Notification({ title, body, icon: notificationIcon, silent: false });
    notifications.add(notification);
    notification.on('show', () => app.emit('studydesk:notification-shown', { title, body }));
    notification.on('click', onClick);
    notification.on('close', () => notifications.delete(notification));
    notification.on('failed', error => { notifications.delete(notification); console.error('Desktop notification:', error); });
    notification.show();
    return true;
  } catch (error) { console.error('Desktop notification:', error); return false; }
}
function checkReminders() {
  let changed = false;
  for (const todo of store.dueReminders()) {
    if (!nativeNotification('待办提醒', todo.title)) showWindow();
    if (store.markReminded(todo.id, todo.remind_at)) { send('desk:reminder', todo); changed = true; }
  }
  if (changed) send('desk:tick', { timer: store.timer, revision: store.revision, reload: true });
}
function trusted(event) {
  if (!win || win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame || !event.senderFrame.url.startsWith('studydesk://app/')) throw new Error('无效来源');
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => showWindow());
  app.on('activate', () => showWindow());
  // 无窗口时保留提醒进程，下一次启动入口会恢复或重建窗口。
  app.on('window-all-closed', () => {});
  app.whenReady().then(() => {
    const dataDir = app.getPath('userData');
    store = new StudyStore(path.join(dataDir, 'studydesk.sqlite'));
    try {
      const vault = new CredentialVault(path.join(dataDir,'companion-key.enc'),safeStorage);
      const companionEvent=event=>{
        const popup = !screenLocked && !suspended && powerMonitor.getSystemIdleTime() < 900 &&
          !(store.timer.status === 'running' && store.timer.mode === 'focus');
        send('desk:companion-event', { ...event, popup });
        if(event.type==='delivered' && popup && (!win?.isVisible()||!win?.isFocused()) && Date.now() - lastChatPopup > 20000) {
          lastChatPopup = Date.now();
          nativeNotification('大肥鱼', (event.content || '发来一条消息').slice(0,130), () => {
            showWindow();
            if (win.webContents.isLoading()) win.webContents.once('did-finish-load', () => send('desk:companion-event', { type: 'open-chat' }));
            else send('desk:companion-event', { type: 'open-chat' });
          }, avatarPath);
        }
      };
      companion = new DafeyuEngine(dataDir,vault,{
        emit:companionEvent,remoteFetch:(...args)=>net.fetch(...args),
        studySnapshot:()=>store.companionSnapshot(),
        presence:()=>({
        available:!screenLocked&&!suspended&&powerMonitor.getSystemIdleState(900)!=='locked'&&powerMonitor.getSystemIdleTime()<900,
        focus:store.timer.status==='running'&&store.timer.mode==='focus',
      })});
    } catch (error) { console.error('Companion could not be opened:',error.message); }
    const backupDir = path.join(dataDir, 'backups');
    backup = () => {
      fs.mkdirSync(backupDir, { recursive: true });
      const filename = path.join(backupDir, `${dayKey(Date.now())}.json`), tmp = filename + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ ...store.exportData(), ...(companion ? { companion: companion.store.exportData() } : {}) }, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, filename);
      const files = fs.readdirSync(backupDir).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse();
      for (const file of files.slice(30)) fs.unlinkSync(path.join(backupDir, file));
      return filename;
    };
    try { backup(); } catch (error) { console.error('Startup backup:', error); }
    protocol.handle('studydesk', request => {
      const url = new URL(request.url);
      if (url.hostname !== 'app') return new Response('Not found', { status: 404 });
      const root = path.join(app.getAppPath(), 'dist');
      const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
      if (!file.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 });
      return net.fetch(pathToFileURL(file).toString());
    });
    session.defaultSession.setPermissionRequestHandler((_, __, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    Menu.setApplicationMenu(null);
    ipcMain.handle('desk:load', e => { trusted(e); return store.snapshot(); });
    ipcMain.handle('desk:companion-load', e => { trusted(e); if (!companion) throw new Error('聊天记录暂时无法打开，请查看数据目录或恢复备份'); return companion.state(); });
    ipcMain.handle('desk:companion-command', async (e, action, payload) => {
      trusted(e);
      try { if (!companion) throw new Error('聊天服务暂时无法打开'); return { ok: true, ...await companion.command(action,payload) }; }
      catch (error) { return { ok: false, error: error.message || '操作失败' }; }
    });
    ipcMain.handle('desk:dispatch', (e, action, payload) => {
      trusted(e);
      try {
        store.dispatch(action, payload);
        try { companion?.publishStudy(); } catch (error) { companion?.report(error); }
        void companion?.syncPresence().catch(error=>companion.report(error));
        return { ok: true, data: store.snapshot() };
      }
      catch (error) { return { ok: false, error: error.message }; }
    });
    ipcMain.handle('desk:quit', e => { trusted(e); setImmediate(() => app.quit()); });
    ipcMain.handle('desk:backup', e => {
      trusted(e);
      try { backup(); return { ok: true, message: '本地备份已保存' }; }
      catch { return { ok: false, error: '备份失败，请检查磁盘空间' }; }
    });
    ipcMain.handle('desk:export', async e => {
      trusted(e);
      const result = await dialog.showSaveDialog(win, { title: '导出完整记录', defaultPath: `studydesk-records-${dayKey(Date.now())}.json`, filters: [{ name: 'JSON 完整记录', extensions: ['json'] }] });
      if (result.canceled || !result.filePath) return { ok: true, canceled: true };
      try {
        fs.writeFileSync(result.filePath + '.tmp', JSON.stringify({ ...store.exportData(), ...(companion ? { companion: companion.store.exportData() } : {}) }, null, 2), { mode: 0o600 });
        fs.renameSync(result.filePath + '.tmp', result.filePath);
        return { ok: true, message: '记录已导出' };
      } catch { return { ok: false, error: '导出失败，请选择可写入的位置' }; }
    });
    try {
      tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 22, height: 22 }));
      tray.setToolTip('StudyDesk · 待办提醒');
      tray.setContextMenu(Menu.buildFromTemplate([{ label: '打开 StudyDesk', click: () => showWindow() }, { type: 'separator' }, { label: '退出应用', click: () => app.quit() }]));
      tray.on('click', () => showWindow());
    } catch (error) { console.error('System tray:', error); }
    interval = setInterval(() => {
      try {
        const previousStatus = store.timer.status, update = store.tick();
        if (update) {
          send('desk:tick', update);
          if (previousStatus === 'running' && update.timer.status === 'completed') nativeNotification(update.timer.mode === 'focus' ? '45 分钟学习完成' : '15 分钟休息结束', '点击打开应用');
        }
        checkReminders();
      } catch (error) { console.error('Background timer:', error); }
    }, 1000);
    const syncPresence=()=>{void companion?.syncPresence().catch(error=>companion.report(error));};
    powerMonitor.on('suspend', () => {suspended=true;syncPresence();pause('电脑已休眠，计时自动暂停');});
    powerMonitor.on('lock-screen', () => {screenLocked=true;syncPresence();pause('电脑已锁屏，计时自动暂停');});
    powerMonitor.on('resume',()=>{suspended=false;syncPresence();});
    powerMonitor.on('unlock-screen',()=>{screenLocked=false;syncPresence();});
    globalShortcut.register('CommandOrControl+Shift+Space', () => showWindow(true));
    showWindow();
    checkReminders();
    if(companion?.config.enabled&&companion.vault.status().configured)
      void companion.start().catch(error=>companion.report(error));
  }).catch(error => { console.error('Application startup:', error); dialog.showErrorBox('StudyDesk 启动失败', String(error.message || error)); app.quit(); });
  let companionStopped=false;
  app.on('before-quit', event => {
    quitting = true; clearInterval(interval);
    try { pause(''); backup(); } catch (error) { console.error('Save on quit:', error); }
    if(companion&&!companionStopped){
      event.preventDefault();companionStopped=true;
      // A local engine may stop within the same microtask turn. Re-entering
      // app.quit before Electron finishes the first quit event is ignored.
      void companion.stop({ preservePending: true }).finally(()=>setImmediate(()=>app.quit()));
    }
  });
  app.on('will-quit', () => {
    runtimeStatus({ running: false, windowReady: false, windowVisible: false });
    globalShortcut.unregisterAll();
    try { store?.close(); } catch (error) { console.error('Database close:', error); }
    try { companion?.close(); } catch { console.error('Companion storage close failed'); }
    tray?.destroy(); app.releaseSingleInstanceLock();
  });
  process.on('SIGTERM', () => app.quit());
  process.on('SIGINT', () => app.quit());
}
