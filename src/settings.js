/**
 * settings.js — хранение настроек пользователя в JSON файле.
 * Сохраняется в папку данных приложения.
 *
 * app.getPath() вызывается лениво (при первом обращении после app.ready),
 * чтобы корректно работать на Linux.
 */

const path = require('path')
const fs   = require('fs-extra')
const { app } = require('electron')

const MANIFEST_URL = 'https://raw.githubusercontent.com/ffxlino/CMML/main/manifest.json'

// Кэш: заполняется один раз при первом вызове после app.ready
let _settingsFile = null
let _defaults     = null

function getSettingsFile() {
  if (!_settingsFile)
    _settingsFile = path.join(app.getPath('userData'), 'settings.json')
  return _settingsFile
}

function getDefaults() {
  if (!_defaults) {
    _defaults = {
      username:  'Player',
      uuid:      null,
      authType:  'offline',

      manifestUrl: MANIFEST_URL,

      gamePath:      path.join(app.getPath('appData'), '.craftsync'),
      minecraftPath: path.join(app.getPath('appData'), '.minecraft'),

      minRam:     1024,
      maxRam:     4096,
      jvmArgs:    '',
      javaPath:   '',

      gameWidth:  1280,
      gameHeight: 720,
      fullscreen: false,

      githubToken:         '',
      closeOnLaunch:       false,
      checkUpdatesOnStart: true,
      language:            'ru',
      accounts:            [],
      launcherRepo:        ''
    }
  }
  return _defaults
}

class Settings {
  constructor() {
    this._data = null  // лениво инициализируется при первом обращении
  }

  _ensureLoaded() {
    if (this._data !== null) return
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
    return this._data[key] !== undefined ? this._data[key] : getDefaults()[key]
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
