const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron')
const path = require('path')
const fs = require('fs')

// На Linux отключаем sandbox — иначе IPC может не работать в AppImage
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-setuid-sandbox')
}

// ─── Глобальный перехват ошибок main процесса ─────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('[FATAL] uncaughtException:', err.message, err.stack)
  try { require('./src/logger').error('uncaughtException', err) } catch {}
})

process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason))
  console.error('[FATAL] unhandledRejection:', err.message)
  try { require('./src/logger').error('unhandledRejection', err) } catch {}
})

// Modules
const ManifestManager = require('./src/manifest')
const Downloader = require('./src/downloader')
const GameLauncher = require('./src/launcher')
const Settings = require('./src/settings')
const ModpackEditor = require('./src/modpack-editor')
const GitHubUploader = require('./src/github-uploader')
const Auth = require('./src/auth')
const Logger = require('./src/logger')

let mainWindow = null

// ─── Create Window ────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    frame: false,          // Убираем стандартную рамку — у нас своя
    transparent: false,
    backgroundColor: '#0d0b14',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false            // Не показываем до готовности
  })

  mainWindow.loadFile('renderer/index.html')

  // Показываем окно только когда страница загружена — без белого мигания
  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  // Открывать внешние ссылки в браузере, не в Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // F12 — открыть/закрыть DevTools для отладки
  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') {
      mainWindow.webContents.isDevToolsOpened()
        ? mainWindow.webContents.closeDevTools()
        : mainWindow.webContents.openDevTools({ mode: 'detach' })
    }
  })

  // Логируем все ошибки рендерера в файл
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    Logger.error('render-process-gone', new Error(JSON.stringify(details)))
  })

  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) { // 2=warning, 3=error
      Logger.session(`[RENDERER ${level === 3 ? 'ERR' : 'WARN'}] ${message} (${sourceId}:${line})`)
    }
  })
}

app.whenReady().then(() => {
  Logger.init(Settings.get('gamePath'))
  Logger.session(`CraftSync запущен (platform=${process.platform}, electron=${process.versions.electron}, node=${process.versions.node})`)
  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

// ─── IPC: Window Controls ─────────────────────────────────────────────────────
ipcMain.on('window:minimize', () => mainWindow.minimize())
ipcMain.on('window:maximize', () => {
  mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
})
ipcMain.on('window:close', () => mainWindow.close())

// ─── IPC: Settings ────────────────────────────────────────────────────────────
ipcMain.handle('settings:get', async () => {
  return Settings.getAll()
})

ipcMain.handle('settings:set', async (event, key, value) => {
  Settings.set(key, value)
  return true
})

ipcMain.handle('settings:browse-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Выберите папку для Minecraft'
  })
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0]
  }
  return null
})

ipcMain.handle('settings:browse-java', async () => {
  const isWin = process.platform === 'win32'
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Выберите исполняемый файл Java',
    filters: isWin
      ? [{ name: 'Java Executable', extensions: ['exe'] }, { name: 'Все файлы', extensions: ['*'] }]
      : [{ name: 'Java Executable', extensions: [''] }, { name: 'Все файлы', extensions: ['*'] }]
  })
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0]
  }
  return null
})

// ─── IPC: Manifest ────────────────────────────────────────────────────────────
ipcMain.handle('manifest:fetch', async (_e, forceRefresh = false) => {
  try {
    if (forceRefresh) ManifestManager.clearCache()
    const manifest = await ManifestManager.fetchManifest(forceRefresh)
    return { success: true, data: manifest }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('manifest:getInstalled', async () => {
  return ManifestManager.getInstalledModpacks()
})

// ─── IPC: Download ────────────────────────────────────────────────────────────
ipcMain.handle('modpack:install', async (event, modpack) => {
  try {
    await Downloader.installModpack(modpack, (progress) => {
      // Отправляем прогресс в рендерер
      mainWindow.webContents.send('download:progress', progress)
    })
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('modpack:update', async (event, modpack) => {
  try {
    await Downloader.updateModpack(modpack, (progress) => {
      mainWindow.webContents.send('download:progress', progress)
    })
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('modpack:delete', async (event, modpackId) => {
  try {
    await Downloader.deleteModpack(modpackId)
    return { success: true }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// ─── IPC: Game Launch ─────────────────────────────────────────────────────────
let _gameStartTime = null
let _gameLaunchedPackId = null

ipcMain.handle('game:launch', async (event, modpackId) => {
  try {
    const settings = Settings.getAll()
    _gameStartTime = null
    _gameLaunchedPackId = modpackId

    await GameLauncher.launch(modpackId, settings, (status) => {
      if (status.status === 'installing') {
        mainWindow.webContents.send('download:progress', {
          modpackId,
          percent: status.percent || 0,
          message: status.message
        })
      } else {
        // Фиксируем момент запуска игры
        if (status.status === 'launched') {
          _gameStartTime = Date.now()
        }
        // При закрытии — считаем время и сохраняем
        if (status.status === 'closed' && _gameStartTime) {
          const minutes = Math.round((Date.now() - _gameStartTime) / 60000)
          if (minutes > 0) {
            try { ManifestManager.updatePlayStats(_gameLaunchedPackId, minutes) } catch {}
          }
          _gameStartTime = null
        }
        mainWindow.webContents.send('game:status', status)
      }
    })
    return { success: true }
  } catch (err) {
    _gameStartTime = null
    return { success: false, error: err.message }
  }
})

// ─── IPC: Auth (Microsoft) ────────────────────────────────────────────────────
ipcMain.handle('auth:login-microsoft', async () => {
  try {
    const result = await Auth.loginWithMicrosoft((msg) => {
      mainWindow.webContents.send('auth:status', { message: msg })
    })
    return { success: true, data: result }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

ipcMain.handle('auth:logout', async () => {
  Auth.logout()
  return { success: true }
})

ipcMain.handle('auth:refresh', async () => {
  try {
    const data = await Auth.refreshIfNeeded()
    return { success: true, data }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// ─── IPC: Modpack Editor (публикация на GitHub) ───────────────────────────────

// Предпросмотр архива — показать список модов без загрузки
ipcMain.handle('editor:preview', async (event, archivePath) => {
  try {
    return await ModpackEditor.previewArchive(archivePath)
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// Выбор файла архива
ipcMain.handle('editor:browse-archive', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Выберите архив сборки',
    filters: [
      { name: 'Архивы', extensions: ['zip', 'rar', '7z'] },
      { name: 'Все файлы', extensions: ['*'] }
    ],
    properties: ['openFile']
  })
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0]
  }
  return null
})

// Публикация — загружает архив и обновляет манифест
ipcMain.handle('editor:publish', async (event, { archivePath, modpackMeta }) => {
  try {
    const result = await ModpackEditor.publishFromArchive(
      archivePath,
      modpackMeta,
      (status) => mainWindow.webContents.send('editor:status', status),
      (progress) => mainWindow.webContents.send('editor:progress', progress)
    )
    return result
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// Проверка GitHub токена
ipcMain.handle('editor:validate-token', async () => {
  try {
    return await GitHubUploader.validateToken()
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// Выбор .jar файлов для патча
ipcMain.handle('editor:browse-jars', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Выберите .jar файлы модов',
    filters: [{ name: 'Minecraft Mods', extensions: ['jar'] }],
    properties: ['openFile', 'multiSelections']
  })
  return result.canceled ? [] : result.filePaths
})

// Патч — добавить .jar в существующий архив и обновить GitHub
ipcMain.handle('editor:patch-modpack', async (event, { modpack, jarPaths }) => {
  try {
    const result = await ModpackEditor.patchModpack(
      modpack,
      jarPaths,
      (status)   => mainWindow.webContents.send('editor:status',   status),
      (progress) => mainWindow.webContents.send('editor:progress', progress)
    )
    return result
  } catch (err) {
    return { success: false, error: err.message }
  }
})

// ─── IPC: GitHub Releases (новости) ──────────────────────────────────────────
ipcMain.handle('releases:fetch', async () => {
  try {
    const https = require('https')
    const { owner, repo } = _parseManifestUrl(Settings.get('manifestUrl'))
    if (!owner || !repo) return { success: false, error: 'URL манифеста не настроен' }

    const url = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=5`
    const data = await _httpsGet(url, Settings.get('githubToken'))
    const releases = JSON.parse(data).map(r => ({
      tag:       r.tag_name,
      name:      r.name || r.tag_name,
      body:      r.body || '',
      date:      r.published_at,
      url:       r.html_url
    }))
    return { success: true, data: releases }
  } catch (err) {
    return { success: false, error: err.message }
  }
})

function _parseManifestUrl(url) {
  if (!url) return {}
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)/)
  if (m) return { owner: m[1], repo: m[2].replace(/\.git$/, '') }
  const m2 = url.match(/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)/)
  if (m2) return { owner: m2[1], repo: m2[2] }
  return {}
}

function _httpsGet(url, token) {
  return new Promise((resolve, reject) => {
    const https = require('https')
    const headers = { 'User-Agent': 'CraftSync-Launcher', 'Accept': 'application/vnd.github.v3+json' }
    if (token) headers['Authorization'] = `token ${token}`
    https.get(url, { headers }, (res) => {
      let data = ''
      res.on('data', c => data += c)
      res.on('end', () => resolve(data))
    }).on('error', reject)
  })
}

// ─── IPC: Accounts ────────────────────────────────────────────────────────────
ipcMain.handle('accounts:list', async () => {
  return Settings.get('accounts') || []
})

ipcMain.handle('accounts:switch', async (_e, accountId) => {
  const accounts = Settings.get('accounts') || []
  const acc = accounts.find(a => a.id === accountId)
  if (!acc) return { success: false, error: 'Аккаунт не найден' }

  // Применяем данные аккаунта как активные
  Settings.set('username',  acc.name)
  Settings.set('uuid',      acc.uuid || null)
  Settings.set('authType',  acc.authType)
  Settings.set('mcToken',   acc.mcToken || null)
  Settings.set('msRefreshToken', acc.msRefreshToken || null)

  return { success: true, data: acc }
})

ipcMain.handle('accounts:remove', async (_e, accountId) => {
  const accounts = (Settings.get('accounts') || []).filter(a => a.id !== accountId)
  Settings.set('accounts', accounts)
  return { success: true }
})

// Сохранить текущий аккаунт в список (вызывается после логина)
ipcMain.handle('accounts:save-current', async () => {
  const s = Settings.getAll()
  if (!s.username || s.authType === 'offline') return { success: false }

  const accounts = s.accounts || []
  const id = s.uuid || s.username
  const existing = accounts.findIndex(a => a.id === id)
  const entry = {
    id:             id,
    name:           s.username,
    uuid:           s.uuid,
    authType:       s.authType,
    mcToken:        s.mcToken || null,
    msRefreshToken: s.msRefreshToken || null,
    addedAt:        new Date().toISOString()
  }
  if (existing >= 0) accounts[existing] = entry
  else accounts.push(entry)

  Settings.set('accounts', accounts)
  return { success: true, data: entry }
})

// ─── IPC: System Info ─────────────────────────────────────────────────────────
ipcMain.handle('system:info', async () => {
  const os = require('os')
  return {
    platform: process.platform,
    arch: process.arch,
    totalRam: Math.round(os.totalmem() / 1024 / 1024 / 1024), // GB
    freeRam: Math.round(os.freemem() / 1024 / 1024 / 1024),
    cpus: os.cpus().length
  }
})

// ─── IPC: App Info ────────────────────────────────────────────────────────────
ipcMain.handle('app:version', () => {
  return app.getVersion()
})

ipcMain.handle('app:clear-installer-cache', async () => {
  try {
    const cacheDir = path.join(app.getPath('userData'), 'installer-cache')
    const fs2 = require('fs-extra')
    if (await fs2.pathExists(cacheDir)) {
      const files = await fs2.readdir(cacheDir)
      for (const f of files) await fs2.remove(path.join(cacheDir, f))
      return { success: true, count: files.length }
    }
    return { success: true, count: 0 }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// ─── IPC: Shell ───────────────────────────────────────────────────────────────
ipcMain.handle('shell:open-path', async (_e, folderPath) => {
  await shell.openPath(folderPath)
  return true
})

ipcMain.handle('shell:open-url', async (_e, url) => {
  await shell.openExternal(url)
  return true
})

// ─── IPC: Logs ────────────────────────────────────────────────────────────────
ipcMain.handle('logs:read-latest', async (_e, lines = 60) => {
  try {
    const logDir = Logger.getLogDir()
    if (!logDir) return { success: false, error: 'Лог не инициализирован' }
    const latestPath = path.join(logDir, 'latest.txt')
    const fsSync = require('fs')
    if (!fsSync.existsSync(latestPath)) return { success: false, error: 'Файл лога не найден' }
    const content = fsSync.readFileSync(latestPath, 'utf-8')
    const tail = content.split('\n').filter(Boolean).slice(-lines).join('\n')
    return { success: true, data: tail, path: latestPath }
  } catch (e) {
    return { success: false, error: e.message }
  }
})

// ─── IPC: Modpack mod list ────────────────────────────────────────────────────
ipcMain.handle('modpack:list-mods', async (_e, modpackId) => {
  try {
    const fs2 = require('fs-extra')
    const modsDir = path.join(Settings.get('gamePath'), 'modpacks', modpackId, 'mods')
    if (!await fs2.pathExists(modsDir)) return { success: true, mods: [] }
    const files = await fs2.readdir(modsDir)
    const mods = files
      .filter(f => f.endsWith('.jar'))
      .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))
      .map(f => {
        const stat = fs2.statSync(path.join(modsDir, f))
        return { name: f, size: Math.round(stat.size / 1024) } // KB
      })
    return { success: true, mods }
  } catch (e) {
    return { success: false, error: e.message, mods: [] }
  }
})

// ─── IPC: Launcher update check ──────────────────────────────────────────────
ipcMain.handle('launcher:check-update', async () => {
  try {
    const repo = Settings.get('launcherRepo')
    if (!repo || !repo.includes('/')) return { hasUpdate: false }

    const currentVersion = app.getVersion()
    const data = await _httpsGet(`https://api.github.com/repos/${repo}/releases/latest`)
    const release = JSON.parse(data)
    const latestTag = (release.tag_name || '').replace(/^v/, '')

    const hasUpdate = latestTag && latestTag !== currentVersion &&
      _isNewerVersion(latestTag, currentVersion)

    return {
      hasUpdate,
      latestVersion: latestTag,
      currentVersion,
      releaseUrl: release.html_url || '',
      releaseName: release.name || latestTag
    }
  } catch {
    return { hasUpdate: false }
  }
})

function _isNewerVersion(latest, current) {
  const parse = v => v.split('.').map(Number)
  const [lMaj, lMin, lPat] = parse(latest)
  const [cMaj, cMin, cPat] = parse(current)
  if (lMaj !== cMaj) return lMaj > cMaj
  if (lMin !== cMin) return lMin > cMin
  return lPat > cPat
}

// ─── IPC: Play Stats ──────────────────────────────────────────────────────────
ipcMain.handle('manifest:update-stats', async (_e, modpackId, minutesPlayed) => {
  try {
    ManifestManager.updatePlayStats(modpackId, minutesPlayed)
    return true
  } catch (e) {
    return false
  }
})
