/**
 * settings.js — хранение настроек пользователя в JSON файле.
 * Сохраняется в папку данных приложения (AppData/Roaming на Windows).
 */

const path = require('path')
const fs = require('fs-extra')
const { app } = require('electron')

const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json')

// URL манифеста — захардкожен, меняется только здесь
const MANIFEST_URL = 'https://raw.githubusercontent.com/ffxlino/CMML/main/manifest.json'

// Настройки по умолчанию
const DEFAULTS = {
  // Личные данные
  username: 'Player',
  uuid: null,
  authType: 'offline',

  // GitHub — источник сборок (фиксированный URL)
  manifestUrl: MANIFEST_URL,

  // Пути
  gamePath:      path.join(app.getPath('appData'), '.craftsync'), // где хранятся сборки
  minecraftPath: path.join(app.getPath('appData'), '.minecraft'), // путь к .minecraft

  // Память Java (MB)
  minRam: 1024,
  maxRam: 4096,

  // Дополнительные аргументы JVM
  jvmArgs: '',

  // Java путь (пустая строка = авто-определение)
  javaPath: '',

  // Разрешение окна игры
  gameWidth: 1280,
  gameHeight: 720,
  fullscreen: false,

  // GitHub публикация
  githubToken: '',          // Personal Access Token (repo scope)

  // Лаунчер
  closeOnLaunch: false,     // закрывать лаунчер при запуске игры
  checkUpdatesOnStart: true,
  language: 'ru',

  // Список сохранённых аккаунтов
  accounts: [],

  // GitHub репозиторий лаунчера для авто-проверки обновлений (например: ffxlino/CraftSync)
  launcherRepo: ''
}

class Settings {
  constructor() {
    this._data = {}
    this._load()
  }

  _load() {
    try {
      if (fs.existsSync(SETTINGS_FILE)) {
        const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8')
        this._data = { ...DEFAULTS, ...JSON.parse(raw) }
      } else {
        this._data = { ...DEFAULTS }
        this._save()
      }
    } catch (err) {
      console.error('[Settings] Ошибка загрузки, используются defaults:', err.message)
      this._data = { ...DEFAULTS }
    }
  }

  _save() {
    try {
      fs.ensureDirSync(path.dirname(SETTINGS_FILE))
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(this._data, null, 2), 'utf-8')
    } catch (err) {
      console.error('[Settings] Ошибка сохранения:', err.message)
    }
  }

  getAll() {
    return { ...this._data }
  }

  get(key) {
    return this._data[key] !== undefined ? this._data[key] : DEFAULTS[key]
  }

  set(key, value) {
    this._data[key] = value
    this._save()
  }

  setMany(obj) {
    Object.assign(this._data, obj)
    this._save()
  }
}

module.exports = new Settings()
