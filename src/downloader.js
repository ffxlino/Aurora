/**
 * downloader.js — скачивание и установка сборок.
 *
 * Новый подход: скачиваем один архив (.zip/.rar/.7z) и распаковываем локально.
 * Никаких сотен отдельных файлов — один файл, один прогресс.
 */

const axios = require('axios')
const https = require('https')
const http = require('http')
const path = require('path')
const fs = require('fs-extra')
const crypto = require('crypto')
const os = require('os')
const Settings = require('./settings')
const ManifestManager = require('./manifest')

function getAdmZip() {
  try { return require('adm-zip') }
  catch { throw new Error('Пакет adm-zip не установлен. Запустите npm install.') }
}
function getSeven() {
  try { return { Seven: require('node-7z'), sevenBin: require('7zip-bin') } }
  catch { throw new Error('Пакет node-7z не установлен. Запустите npm install.') }
}

class Downloader {

  // ── Установить сборку ─────────────────────────────────────────────────────
  async installModpack(modpack, onProgress) {
    console.log(`[Downloader] Установка: ${modpack.name} v${modpack.version}`)

    const modpackDir = this._getModpackDir(modpack.id)
    const modsDir = path.join(modpackDir, 'mods')

    // Очищаем старую папку модов
    await fs.emptyDir(modsDir)

    // Скачиваем и распаковываем
    await this._downloadAndExtract(modpack, modsDir, onProgress)

    // Сохраняем мета-данные сборки (для launcher.js)
    await fs.writeJson(path.join(modpackDir, 'craftsync-meta.json'), modpack, { spaces: 2 })

    ManifestManager.markInstalled(modpack.id, modpack.version)

    onProgress({
      modpackId: modpack.id,
      status: 'done',
      percent: 100,
      message: `✅ ${modpack.name} установлен!`
    })
  }

  // ── Обновить сборку (с защитой пользовательских файлов) ─────────────────
  async updateModpack(modpack, onProgress) {
    console.log(`[Downloader] Обновление: ${modpack.name} → v${modpack.version}`)

    const modpackDir = this._getModpackDir(modpack.id)

    // Файлы которые НЕ трогаем при обновлении (пользовательские настройки)
    const PROTECTED = [
      'options.txt',        // настройки клавиш и графики
      'servers.dat',        // список серверов
      'saves',              // одиночные миры
      'screenshots',        // скриншоты
      'resourcepacks',      // ресурспаки пользователя
      'shaderpacks',        // шейдеры пользователя
      'local',              // локальные настройки некоторых модов
    ]
    // Дополнительные защищённые файлы из манифеста
    const custom = modpack.protectedFiles || []
    const allProtected = [...PROTECTED, ...custom]

    // Создаём временный бэкап
    const backupDir = path.join(os.tmpdir(), `craftsync-backup-${modpack.id}-${Date.now()}`)
    await fs.ensureDir(backupDir)

    let backedUp = 0
    for (const name of allProtected) {
      const src = path.join(modpackDir, name)
      if (await fs.pathExists(src)) {
        await fs.copy(src, path.join(backupDir, name), { overwrite: true })
        backedUp++
      }
    }
    if (backedUp > 0) {
      console.log(`[Downloader] Защищено ${backedUp} файл(ов) при обновлении`)
    }

    // Устанавливаем новую версию
    await this.installModpack(modpack, onProgress)

    // Восстанавливаем пользовательские файлы
    for (const name of allProtected) {
      const backup = path.join(backupDir, name)
      if (await fs.pathExists(backup)) {
        await fs.copy(backup, path.join(modpackDir, name), { overwrite: true })
      }
    }

    // Удаляем временный бэкап
    await fs.remove(backupDir).catch(() => {})
  }

  // ── Удалить сборку ────────────────────────────────────────────────────────
  async deleteModpack(modpackId) {
    const modpackDir = this._getModpackDir(modpackId)
    if (await fs.pathExists(modpackDir)) {
      await fs.remove(modpackDir)
    }
    ManifestManager.markUninstalled(modpackId)
    console.log(`[Downloader] Удалена сборка: ${modpackId}`)
  }

  // ── Скачать архив и распаковать ───────────────────────────────────────────
  async _downloadAndExtract(modpack, modsDir, onProgress) {
    // Поддержка нового формата (archiveUrl) и старого (mods[])
    if (modpack.archiveUrl) {
      await this._downloadArchive(modpack, modsDir, onProgress)
    } else if (modpack.mods && modpack.mods.length > 0) {
      await this._downloadIndividualMods(modpack, modsDir, onProgress)
    } else {
      throw new Error('В сборке нет ссылок на файлы. Попробуйте переопубликовать её.')
    }
  }

  // ── Скачать один архив и распаковать ─────────────────────────────────────
  async _downloadArchive(modpack, modsDir, onProgress) {
    const ext = modpack.archiveExt || '.zip'
    const tmpFile = path.join(os.tmpdir(), `craftsync-${modpack.id}-${Date.now()}${ext}`)

    try {
      onProgress({
        modpackId: modpack.id,
        status: 'downloading',
        percent: 0,
        message: `Скачиваем сборку (${modpack.sizeMb || '?'} MB)...`
      })

      // Скачиваем архив через нативный https (быстрее axios для больших файлов)
      await this._downloadFast(modpack.archiveUrl, tmpFile, (downloadedBytes, totalBytes) => {
        const pct = totalBytes > 0
          ? Math.round((downloadedBytes / totalBytes) * 80)
          : 0
        onProgress({
          modpackId: modpack.id,
          status: 'downloading',
          percent: pct,
          message: `Скачиваем: ${pct}% (${(downloadedBytes/1024/1024).toFixed(1)} / ${(totalBytes/1024/1024).toFixed(1)} MB)`
        })
      })

      // Проверяем хэш если есть
      if (modpack.archiveHash) {
        onProgress({ modpackId: modpack.id, status: 'verifying', percent: 82, message: 'Проверяем целостность...' })
        const hash = await this._sha256(tmpFile)
        if (hash !== modpack.archiveHash) {
          throw new Error('Ошибка проверки архива. Файл повреждён, попробуйте ещё раз.')
        }
      }

      // Распаковываем
      onProgress({ modpackId: modpack.id, status: 'extracting', percent: 85, message: 'Распаковываем моды...' })
      await this._extract(tmpFile, modsDir, ext)

      onProgress({ modpackId: modpack.id, status: 'extracting', percent: 98, message: 'Готово!' })

    } finally {
      await fs.remove(tmpFile).catch(() => {})
    }
  }

  // ── Быстрая загрузка файла (нативный https, следует редиректам) ───────────
  _downloadFast(url, destPath, onChunk) {
    return new Promise((resolve, reject) => {
      const doRequest = (currentUrl, redirectCount = 0) => {
        if (redirectCount > 10) return reject(new Error('Слишком много редиректов'))

        const lib = currentUrl.startsWith('https') ? https : http
        const req = lib.get(currentUrl, {
          headers: {
            'User-Agent': 'CraftSync-Launcher/0.1.0',
            'Accept': '*/*'
          },
          // Большой буфер для быстрой загрузки
          highWaterMark: 1024 * 1024 * 4  // 4 MB chunks
        }, (res) => {
          // Следуем редиректам (GitHub → CDN)
          if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
            res.resume()
            return doRequest(res.headers.location, redirectCount + 1)
          }

          if (res.statusCode !== 200) {
            res.resume()
            return reject(new Error(`HTTP ${res.statusCode} при скачивании архива`))
          }

          const totalBytes = parseInt(res.headers['content-length'] || '0')
          let downloadedBytes = 0

          const writer = fs.createWriteStream(destPath, {
            highWaterMark: 1024 * 1024 * 4  // 4 MB write buffer
          })

          res.on('data', (chunk) => {
            downloadedBytes += chunk.length
            onChunk(downloadedBytes, totalBytes)
          })

          res.pipe(writer)
          writer.on('finish', resolve)
          writer.on('error', reject)
          res.on('error', reject)
        })

        req.setTimeout(600000, () => {  // 10 минут таймаут
          req.destroy()
          reject(new Error('Таймаут скачивания (10 минут)'))
        })
        req.on('error', reject)
      }

      doRequest(url)
    })
  }

  // ── Распаковать архив ─────────────────────────────────────────────────────
  async _extract(archivePath, destDir, ext) {
    await fs.ensureDir(destDir)

    if (ext === '.zip') {
      const AdmZip = getAdmZip()
      const zip = new AdmZip(archivePath)
      const entries = zip.getEntries()

      // Кладём .jar прямо в mods/, игнорируем вложенность папок
      let extracted = 0
      for (const entry of entries) {
        if (!entry.isDirectory && entry.name.endsWith('.jar')) {
          zip.extractEntryTo(entry, destDir, /*maintainEntryPath*/ false, /*overwrite*/ true)
          extracted++
        }
      }
      console.log(`[Downloader] Extracted ${extracted} .jar files`)
    } else {
      // RAR / 7z — через 7-zip
      const { Seven, sevenBin } = getSeven()
      await new Promise((resolve, reject) => {
        const stream = Seven.extractFull(archivePath, destDir, {
          $bin: sevenBin.path7za,
          recursive: true,
          overwrite: 'a',
          // Плоская структура — только jar файлы
          wildcards: ['*.jar'],
          flattenFolder: true
        })
        stream.on('end', resolve)
        stream.on('error', reject)
      })
    }
  }

  // ── Скачать моды по одному (старый формат манифеста) ─────────────────────
  async _downloadIndividualMods(modpack, modsDir, onProgress) {
    const mods = modpack.mods || []
    let done = 0

    for (const mod of mods) {
      onProgress({
        modpackId: modpack.id,
        status: 'downloading',
        percent: Math.round((done / mods.length) * 100),
        currentFile: mod.filename,
        message: `Скачиваем: ${mod.filename}`
      })

      const filePath = path.join(modsDir, mod.filename)

      // Пропускаем если уже есть с правильным хэшем
      if (await fs.pathExists(filePath) && mod.sha256) {
        const hash = await this._sha256(filePath)
        if (hash === mod.sha256) { done++; continue }
      }

      await this._downloadFile(mod.url, filePath)
      done++
    }
  }

  async _downloadFile(url, destPath) {
    const response = await axios({
      method: 'GET', url,
      responseType: 'stream',
      timeout: 120000,
      headers: { 'User-Agent': 'CraftSync-Launcher/0.1' }
    })
    await fs.ensureDir(path.dirname(destPath))
    return new Promise((resolve, reject) => {
      const writer = fs.createWriteStream(destPath)
      response.data.pipe(writer)
      writer.on('finish', resolve)
      writer.on('error', reject)
    })
  }

  async _sha256(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256')
      const stream = fs.createReadStream(filePath)
      stream.on('data', chunk => hash.update(chunk))
      stream.on('end', () => resolve(hash.digest('hex')))
      stream.on('error', reject)
    })
  }

  _getModpackDir(modpackId) {
    return path.join(Settings.get('gamePath'), 'modpacks', modpackId)
  }
}

module.exports = new Downloader()
