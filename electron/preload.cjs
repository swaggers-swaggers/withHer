const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('studyDesk', {
  runtime: { sandboxed: process.sandboxed, contextIsolated: process.contextIsolated },
  load: () => ipcRenderer.invoke('desk:load'),
  companionLoad: () => ipcRenderer.invoke('desk:companion-load'),
  companionCommand: (action, payload) => ipcRenderer.invoke('desk:companion-command', action, payload),
  onCompanion: (listener) => {
    const handler = (_, event) => listener(event);
    ipcRenderer.on('desk:companion-event', handler);
    return () => ipcRenderer.removeListener('desk:companion-event', handler);
  },
  dispatch: (action, payload) => ipcRenderer.invoke('desk:dispatch', action, payload),
  exportData: () => ipcRenderer.invoke('desk:export'),
  backup: () => ipcRenderer.invoke('desk:backup'),
  quit: () => ipcRenderer.invoke('desk:quit'),
  onReminder: (listener) => {
    const handler = (_, todo) => listener(todo);
    ipcRenderer.on('desk:reminder', handler);
    return () => ipcRenderer.removeListener('desk:reminder', handler);
  },
  onTick: (listener) => {
    const handler = (_, update) => listener(update);
    ipcRenderer.on('desk:tick', handler);
    return () => ipcRenderer.removeListener('desk:tick', handler);
  },
  onQuickAdd: (listener) => {
    ipcRenderer.on('desk:quick-add', listener);
    return () => ipcRenderer.removeListener('desk:quick-add', listener);
  },
});
