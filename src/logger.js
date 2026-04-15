/**
 * logger.js — запись логов сессии в папку logs/
 *
 * Каждый запуск лаунчера = новый файл: logs/session-2026-04-13_15-30-00.txt
 * Последняя сессия всегда доступна как logs/latest.txt
 */

const path = require('path')
const fs = require('fs-extra')
const { app } = require('electron')

class Logger {
  constructor() {
    this._stream = null
    this._logDir = null
    this._initialized = false
  }

  // Вызывается один раз при старте main.js
  init(gamePath) {
    try {
      this._logDir = path.join(gamePath || app.getPath('userData'), 'logs')
      fs.ensureDirSync(this._logDir)

      const now = new Date()
      const stamp = now.toISOString()
        .replace('T', '_')
        .replace(/:/g, '-')
        .slice(0, 19)

      const sessionFile = path.join(this._logDir, `session-${stamp}.txt`)
      const latestFile  = path.join(this._logDir, 'latest.txt')

      this._stream = fs.createWriteStream(sessionFile, { flags: 'a' })

      // latest.txt — всегда ссылается на последнюю сессию
      this._latestStream = fs.createWriteStream(latestFile, { flags: 'w' })

      this._initialized = true

      this._write(`CraftSync Launcher — сессия ${now.toLocaleString('ru')}`)
      this._write('='.repeat(60))

      // Удаляем старые логи (держим последние 10)
      this._cleanOldLogs()

      console.log(`[Logger] Лог сессии: ${sessionFile}`)
    } catch (err) {
      console.error('[Logger] Ошибка инициализации:', err.message)
    }
  }

  // Записать строку в лог
  session(line) {
    const ts = new Date().toLocaleTimeString('ru', { hour12: false })
    this._write(`[${ts}] ${line}`)
  }

  // Записать ошибку
  error(context, err) {
    this.session(`[ERROR] ${context}: ${err?.message || err}`)
    if (err?.stack) this._write(err.stack)
  }

  _write(line) {
    if (!this._initialized) return
    const out = line + '\n'
    try {
      this._stream?.write(out)
      this._latestStream?.write(out)
    } catch { /* ignore */ }
  }

  _cleanOldLogs() {
    try {
      const files = fs.readdirSync(this._logDir)
        .filter(f => f.startsWith('session-') && f.endsWith('.txt'))
        .map(f => ({ name: f, time: fs.statSync(path.join(this._logDir, f)).mtimeMs }))
        .sort((a, b) => b.time - a.time)

      // Удаляем всё кроме последних 10
      files.slice(10).forEach(f => {
        fs.removeSync(path.join(this._logDir, f.name))
      })
    } catch { /* ignore */ }
  }

  getLogDir() { return this._logDir }
}

module.exports = new Logger()
