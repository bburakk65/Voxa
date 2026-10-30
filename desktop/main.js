const { app, BrowserWindow, Menu, shell, dialog, session, desktopCapturer, net } = require('electron');
const path = require('path');

const SITE = 'https://voxa.voxaweb.workers.dev/';
const HOST = new URL(SITE).host;
const REPO = 'bburakk65/Voxa';
const ALLOWED = ['media', 'audioCapture', 'videoCapture', 'clipboard-sanitized-write', 'fullscreen', 'notifications'];
let win = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

function isSite(u) {
  try {
    const x = new URL(u);
    return x.protocol === 'https:' && x.host === HOST;
  } catch (e) {
    return false;
  }
}

function cmpVer(a, b) {
  const x = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const y = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = x[i] || 0, q = y[i] || 0;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

function platformKey() {
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'linux') return 'linux';
  return process.arch === 'arm64' ? 'macosArm64' : 'macosX64';
}

async function checkUpdates(manual) {
  try {
    const res = await net.fetch('https://github.com/' + REPO + '/releases/latest/download/version.json');
    if (!res.ok) throw new Error('Sunucu cevabı: ' + res.status);
    const info = JSON.parse(await res.text());
    if (info.app !== 'Voxa' || !/^\d{1,4}\.\d{1,4}\.\d{1,9}$/.test(String(info.versionName))) throw new Error('Sürüm bilgisi geçersiz');
    if (cmpVer(info.versionName, app.getVersion()) <= 0) {
      if (manual) await dialog.showMessageBox(win, { type: 'info', title: 'Voxa', message: 'Voxa güncel ✓', detail: 'Yüklü sürüm: v' + app.getVersion() });
      return;
    }
    const f = info.files && info.files[platformKey()];
    const okName = f && typeof f.file === 'string' && /^Voxa-v[0-9.]+-[A-Za-z0-9._-]+$/.test(f.file);
    const notes = String(info.notes || '').slice(0, 600);
    const r = await dialog.showMessageBox(win, {
      type: 'info', title: 'Yeni sürüm', buttons: [okName ? 'İndir' : 'İndirme sayfasını aç', 'Daha sonra'], defaultId: 0, cancelId: 1,
      message: 'Voxa v' + info.versionName + ' yayında', detail: (notes || 'Yeni sürüm var.') + '\n\nYüklü sürüm: v' + app.getVersion() + '\nİndirdikten sonra dosyayı çalıştırıp kur; verilerin korunur.'
    });
    if (r.response === 0) {
      const url = okName
        ? 'https://github.com/' + REPO + '/releases/download/v' + info.versionName + '/' + f.file
        : SITE + 'indir.html';
      shell.openExternal(url);
    }
  } catch (e) {
    if (manual) await dialog.showMessageBox(win, { type: 'warning', title: 'Voxa', message: 'Güncelleme sunucusuna ulaşılamadı', detail: 'İnternetini kontrol edip tekrar dene.' });
  }
}

function setupSession() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, cb, details) => {
    cb(isSite(details.requestingUrl) && ALLOWED.includes(permission));
  });
  ses.setPermissionCheckHandler((wc, permission, origin) => isSite(origin) && ALLOWED.includes(permission));
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } });
      if (!sources.length) return callback({});
      const list = sources.slice(0, 6);
      const names = list.map((s) => String(s.name).slice(0, 60));
      const r = await dialog.showMessageBox(win, {
        type: 'question', buttons: names.concat(['Vazgeç']), cancelId: names.length, defaultId: 0,
        title: 'Ekran paylaşımı', message: 'Hangi ekranı ya da pencereyi paylaşmak istiyorsun?'
      });
      if (r.response >= names.length) return callback({});
      callback({ video: list[r.response] });
    } catch (e) {
      callback({});
    }
  });
}

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Voxa', submenu: [
      { label: 'Yeniden yükle', accelerator: 'CmdOrCtrl+R', click: () => { if (win) win.loadURL(SITE); } },
      { label: 'Güncellemeleri denetle', click: () => checkUpdates(true) },
      { label: 'İndirme sayfası', click: () => shell.openExternal(SITE + 'indir.html') },
      { label: 'Hakkında', click: () => dialog.showMessageBox(win, { type: 'info', title: 'Voxa', message: 'Voxa masaüstü v' + app.getVersion(), detail: SITE }) },
      { type: 'separator' },
      { role: 'quit', label: 'Çık' }
    ] },
    { label: 'Düzen', submenu: [
      { role: 'undo', label: 'Geri al' }, { role: 'redo', label: 'Yinele' }, { type: 'separator' },
      { role: 'cut', label: 'Kes' }, { role: 'copy', label: 'Kopyala' }, { role: 'paste', label: 'Yapıştır' }, { role: 'selectAll', label: 'Tümünü seç' }
    ] },
    { label: 'Görünüm', submenu: [
      { role: 'togglefullscreen', label: 'Tam ekran' }, { role: 'zoomIn', label: 'Yakınlaştır' },
      { role: 'zoomOut', label: 'Uzaklaştır' }, { role: 'resetZoom', label: 'Yakınlaştırmayı sıfırla' }
    ] }
  ]));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180, height: 800, minWidth: 420, minHeight: 560, backgroundColor: '#1e1f22', title: 'Voxa',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
  });
  const ua = win.webContents.getUserAgent().replace(/ Electron\/[\d.]+/, '') + ' VoxaDesktop/' + app.getVersion();
  win.webContents.setUserAgent(ua);
  win.loadURL(SITE);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!isSite(url) && !url.startsWith('file://')) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });
  win.webContents.on('did-fail-load', (e, code, desc, url, isMain) => {
    if (isMain && code !== -3) win.loadFile(path.join(__dirname, 'offline.html'), { query: { m: String(desc) } });
  });
  win.on('closed', () => { win = null; });
}

app.whenReady().then(() => {
  setupSession();
  buildMenu();
  createWindow();
  setTimeout(() => checkUpdates(false), 4000);
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
