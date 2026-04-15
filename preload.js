/**
 * preload.js — безопасный мост между рендерером и main процессом.
 * contextIsolation включён, поэтому Node API недоступен в рендерере напрямую.
 * Всё взаимодействие только через этот файл.
 */

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {

  // ── Window Controls ──────────────────────────────────────────────────────
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close:    () => ipcRenderer.send('window:close'),
  },

  // ── Settings ─────────────────────────────────────────────────────────────
  settings: {
    get:          ()          => ipcRenderer.invoke('settings:get'),
    set:          (key, val)  => ipcRenderer.invoke('settings:set', key, val),
    browseFolder: ()          => ipcRenderer.invoke('settings:browse-folder'),
    browseJava:   ()          => ipcRenderer.invoke('settings:browse-java'),
  },

  // ── App Info ─────────────────────────────────────────────────────────────
  app: {
    version:             () => ipcRenderer.invoke('app:version'),
    clearInstallerCache: () => ipcRenderer.invoke('app:clear-installer-cache'),
  },

  // ── Shell ────────────────────────────────────────────────────────────────
  shell: {
    openPath: (p)   => ipcRenderer.invoke('shell:open-path', p),
    openUrl:  (url) => ipcRenderer.invoke('shell:open-url', url),
  },

  // ── Logs ─────────────────────────────────────────────────────────────────
  logs: {
    readLatest: (lines) => ipcRenderer.invoke('logs:read-latest', lines),
  },

  // ── Launcher updates ─────────────────────────────────────────────────────
  launcher: {
    checkUpdate: () => ipcRenderer.invoke('launcher:check-update'),
  },

  // ── Manifest (список сборок с GitHub) ────────────────────────────────────
  manifest: {
    fetch:        (force)              => ipcRenderer.invoke('manifest:fetch', force),
    getInstalled: ()                   => ipcRenderer.invoke('manifest:getInstalled'),
    updateStats:  (id, minutes)        => ipcRenderer.invoke('manifest:update-stats', id, minutes),
  },

  // ── Modpack Actions ───────────────────────────────────────────────────────
  modpack: {
    install:   (modpack)   => ipcRenderer.invoke('modpack:install', modpack),
    update:    (modpack)   => ipcRenderer.invoke('modpack:update', modpack),
    delete:    (modpackId) => ipcRenderer.invoke('modpack:delete', modpackId),
    listMods:  (modpackId) => ipcRenderer.invoke('modpack:list-mods', modpackId),
  },

  // ── Game Launch ───────────────────────────────────────────────────────────
  game: {
    launch: (modpackId) => ipcRenderer.invoke('game:launch', modpackId),
  },

  // ── System Info ───────────────────────────────────────────────────────────
  system: {
    info: () => ipcRenderer.invoke('system:info'),
  },

  // ── Auth ─────────────────────────────────────────────────────────────────
  auth: {
    loginMicrosoft: () => ipcRenderer.invoke('auth:login-microsoft'),
    logout:         () => ipcRenderer.invoke('auth:logout'),
    refresh:        () => ipcRenderer.invoke('auth:refresh'),
  },

  // ── Modpack Editor (публикация) ───────────────────────────────────────────
  editor: {
    browseArchive:  ()                         => ipcRenderer.invoke('editor:browse-archive'),
    browseJars:     ()                         => ipcRenderer.invoke('editor:browse-jars'),
    preview:        (archivePath)              => ipcRenderer.invoke('editor:preview', archivePath),
    publish:        (archivePath, modpackMeta) => ipcRenderer.invoke('editor:publish', { archivePath, modpackMeta }),
    patchModpack:   (modpack, jarPaths)        => ipcRenderer.invoke('editor:patch-modpack', { modpack, jarPaths }),
    validateToken:  ()                         => ipcRenderer.invoke('editor:validate-token'),
  },

  // ── GitHub Releases (новости) ─────────────────────────────────────────────
  releases: {
    fetch: () => ipcRenderer.invoke('releases:fetch'),
  },

  // ── Accounts ──────────────────────────────────────────────────────────────
  accounts: {
    list:        ()    => ipcRenderer.invoke('accounts:list'),
    switch:      (id)  => ipcRenderer.invoke('accounts:switch', id),
    remove:      (id)  => ipcRenderer.invoke('accounts:remove', id),
    saveCurrent: ()    => ipcRenderer.invoke('accounts:save-current'),
  },

  // ── Event Listeners (main → renderer) ────────────────────────────────────
  on: {
    downloadProgress: (cb) => {
      ipcRenderer.on('download:progress', (_, data) => cb(data))
    },
    gameStatus: (cb) => {
      ipcRenderer.on('game:status', (_, data) => cb(data))
    },
    editorStatus: (cb) => {
      ipcRenderer.on('editor:status', (_, data) => cb(data))
    },
    editorProgress: (cb) => {
      ipcRenderer.on('editor:progress', (_, data) => cb(data))
    },
    authStatus: (cb) => {
      ipcRenderer.on('auth:status', (_, data) => cb(data))
    },
    // Снять слушатель
    remove: (channel) => {
      ipcRenderer.removeAllListeners(channel)
    }
  }

})
