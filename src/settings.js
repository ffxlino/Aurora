/**
 * settings.js — хранение настроек пользователя в JSON файле.
 * Сохраняется в папку данных приложения (AppData/Roaming на Windows,
 * ~/.config на Linux).
 *
 * ВАЖНО: app.getPath() вызывается лениво (только после app.ready),
 * чтобы не падать на Linux при загрузке модуля до инициализации Electron.
 */

const path = require('path')
const fs = require('fs-extra')
const { app } = require('electron')

// URL манифеста — захардкожен, меняется только здесь
const MANIFEST_URL = 'https://raw.githubusercontent.com/ffxlino/CMML/main/manifest.json'

// Ленивые геттеры путей — вызываются только после app.ready
function getSettingsFile() {
  return path.join(app.getPath('userData'), 'settings.json')
}

function getDefaults() {
  return {
    // Личные данные
    username:  'Player',
    uuid:      null,
    authType:  'offline',

    // GitHub — источник сборок (фиксированный URL)
    manifestUrl: MANIFEST_URL,

    // Пути
    gamePath:      path.join(app.getPath('appData'), '.craftsync'),
    minecraftPath: path.join(app.getPath('appData'), '.minecraft'),

    // Память Java (MB)
    minRam: 1024,
    maxRam: 4096,

    // Дополнительные аргументы JVM
    jvmArgs: '',

    // Java путь (пустая строка = авто-определение)
    javaPath: '',

    // Разрешение окна игры
    gameWidth:  1280,
    gameHeight: 720,
    fullscreen: false,

    // GitHub публикация
    githubToken: '',

    // Лаунчер
    closeOnLaunch:      false,
    checkUpdatesOnStart: true,
    language:           'ru',

    // Список сохранённых аккаунтов
    accounts: [],

    // GitHub репозиторий лаунчера для авто-проверки обновлений
    launcherRepo: ''
  }
}

class Settings {
  constructor() {
    this._data = null   // загружается лениво при первом обращении
  }

  // Ленивая инициализация — безопасна для вызова до app.ready
  _ensureLoaded() {
    if (this._data !== null) return
    this._load()
  }

  _load() {
    const defaults = getDefaults()
    try {
      const file = getSettingsFile()
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, 'utf-8')
        this._data = { ...defaults, ...JSON.parse(raw) }
      } else {
        this._data = { ...defaults }
        this._save()
      }
    } catch (err) {
      console.error('[Settings] Ошибка загрузки, используются defaults:', err.message)
      this._data = { ...defaults }
    }
  }

  _save() {
    try {
      const file = getSettingsFile()
      fs.ensureDirSync(path.dirname(file))
      fs.writeFileSync(file, JSON.stringify(this._data, null, 2), 'utf-8')
    } catch (err) {
      console.error('[Settings] Ошибка сохранения:', err.message)
    }
  }

  getAll() {
    this._ensureLoaded()
    return { ...this._data }
  }

  get(key) {
    this._ensureLoaded()
    const defaults = getDefaults()
    return this._data[key] !== undefined ? this._data[key] : defaults[key]
  }

  set(key, value) {
    this._ensureLoaded()
    this._data[key] = value
    this._save()
  }

  setMany(obj) {
    this._ensureLoaded()
    Object.assign(this._data, obj)
    this._save()
  }
}

module.exports = new Settings()
