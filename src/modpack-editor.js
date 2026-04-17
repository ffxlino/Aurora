/**
 * modpack-editor.js — публикация сборки на GitHub.
 *
 * НОВЫЙ ПОДХОД: загружаем архив целиком одним файлом.
 * Лаунчер скачивает zip и сам распаковывает — никаких 80 отдельных файлов.
 *
 * Поток:
 *  1. Сканируем архив (считаем моды, размер) — без полной распаковки
 *  2. Загружаем архив целиком на GitHub Release
 *  3. Обновляем manifest.json: одна ссылка на архив
 */

const path = require('path')
const fs = require('fs-extra')
const crypto = require('crypto')
const https = require('https')
const http = require('http')
const Settings = require('./settings')
const GitHubUploader = require('./github-uploader')

// Ленивые импорты
function getAdmZip() {
  try { return require('adm-zip') }
  catch { throw new Error('Пакет adm-zip не установлен. Запустите npm install.') }
}
function getSeven() {
  try { return { Seven: require('node-7z'), sevenBin: require('7zip-bin') } }
  catch { throw new Error('Пакет node-7z не установлен. Запустите npm install.') }
}

class ModpackEditor {

  // ── Предпросмотр архива без загрузки ──────────────────────────────────────
  async previewArchive(archivePath) {
    try {
      const ext = path.extname(archivePath).toLowerCase()
      const stat = await fs.stat(archivePath)
      const sizeMb = parseFloat((stat.size / 1024 / 1024).toFixed(1))

      let mods = []

      if (ext === '.zip') {
        const AdmZip = getAdmZip()
        const zip = new AdmZip(archivePath)
        const entries = zip.getEntries()
        mods = entries
          .filter(e => !e.isDirectory && e.name.endsWith('.jar'))
          .map(e => ({
            name: e.name.replace(/\.jar$/, ''),
            filename: e.name,
            sizeMb: parseFloat((e.header.size / 1024 / 1024).toFixed(2))
          }))
      } else {
        // Для .rar и .7z просто сообщаем размер архива
        mods = [{ name: `Архив ${ext}`, filename: path.basename(archivePath), sizeMb }]
      }

      return { success: true, mods, totalMods: mods.length, archiveSizeMb: sizeMb }
    } catch (err) {
      return { success: false, error: err.message }
    }
  }

  // ── Обогащённый список модов с Modrinth метаданными ──────────────────────
  // Возвращает массив объектов: { filename, displayName, sha1, iconUrl, side, modrinthId, source }
  async enrichModsFromArchive(archivePath, onStatus) {
    try {
      const ext = path.extname(archivePath).toLowerCase()
      if (ext !== '.zip') return []

      if (onStatus) onStatus({ step: 'hash', message: 'Вычисляем SHA1 модов...' })
      const AdmZip = getAdmZip()
      const zip = new AdmZip(archivePath)
      const entries = zip.getEntries().filter(e => !e.isDirectory && e.name.endsWith('.jar'))

      if (entries.length === 0) return []

      // Вычисляем SHA1 для каждого .jar
      const hashToMod = {}
      const hashes = []
      for (const entry of entries) {
        const data = entry.getData()
        const sha1 = crypto.createHash('sha1').update(data).digest('hex')
        hashToMod[sha1] = {
          filename:    entry.name,
          displayName: this._cleanModName(entry.name),
          sha1,
          iconUrl:     null,
          side:        'both',
          modrinthId:  null,
          source:      'custom'
        }
        hashes.push(sha1)
      }

      // Запрашиваем Modrinth
      if (onStatus) onStatus({ step: 'modrinth', message: `Запрашиваем Modrinth для ${hashes.length} модов...` })
      await this._lookupModrinth(hashes, hashToMod)

      return Object.values(hashToMod)
    } catch (err) {
      console.error('[ModpackEditor] enrichModsFromArchive error:', err.message)
      return []
    }
  }

  // ── Основной метод: загрузить архив целиком и обновить манифест ───────────
  async publishFromArchive(archivePath, modpackMeta, onStatus, onProgress) {
    const ext = path.extname(archivePath).toLowerCase()
    const archiveFilename = `${modpackMeta.id}-v${modpackMeta.version}${ext}`
    const stat = await fs.stat(archivePath)
    const archiveSizeMb = parseFloat((stat.size / 1024 / 1024).toFixed(1))

    // Считаем SHA-256 архива целиком
    onStatus({ step: 'hash', message: 'Вычисляем контрольную сумму архива...' })
    const archiveHash = await this._sha256(archivePath)

    // Обогащаем моды через Modrinth (иконки, сторона запуска)
    onStatus({ step: 'mods', message: 'Получаем метаданные модов (Modrinth)...' })
    let enrichedMods = []
    try {
      enrichedMods = await this.enrichModsFromArchive(archivePath,
        msg => onStatus({ step: 'mods', message: msg.message || msg, silent: true })
      )
    } catch { /* не критично */ }

    // Считаем количество модов
    let totalMods = enrichedMods.length || modpackMeta.totalMods || 0
    if (ext === '.zip' && !totalMods) {
      try {
        const AdmZip = getAdmZip()
        const zip = new AdmZip(archivePath)
        totalMods = zip.getEntries().filter(e => !e.isDirectory && e.name.endsWith('.jar')).length
      } catch { /* не критично */ }
    }

    // Проверяем настройки GitHub
    const manifestUrl = Settings.get('manifestUrl')
    if (!manifestUrl || manifestUrl.includes('YOUR_USERNAME')) {
      throw new Error('URL манифеста не настроен. Укажите его в Настройках.')
    }

    const { owner, repo } = GitHubUploader.parseRepo(manifestUrl)
    const branch = GitHubUploader.parseBranch(manifestUrl)

    // Создаём/получаем релиз
    const release = await GitHubUploader.ensureRelease(
      owner, repo,
      modpackMeta.id, modpackMeta.version,
      msg => onStatus({ step: 'github', message: msg })
    )

    // Загружаем архив одним файлом
    onStatus({ step: 'upload', message: `Загружаем архив: ${archiveFilename} (${archiveSizeMb} MB)...` })

    const downloadUrl = await GitHubUploader.uploadAsset(
      release,
      archivePath,
      archiveFilename,
      (pct) => {
        // Только прогресс-бар — без записи в лог
        onProgress({ step: 'upload', overall: pct, filename: archiveFilename, silent: true })
      }
    )

    onStatus({ step: 'upload', message: `Архив загружен!`, percent: 100 })

    // Получаем текущий манифест
    onStatus({ step: 'manifest', message: 'Обновляем manifest.json...' })
    const { manifest, sha } = await GitHubUploader.fetchCurrentManifest(owner, repo, branch)

    // Формируем запись сборки — одна ссылка на архив
    const modpackEntry = {
      id:             modpackMeta.id,
      name:           modpackMeta.name,
      version:        modpackMeta.version,
      mcVersion:      modpackMeta.mcVersion,
      loader:         modpackMeta.loader,
      loaderVersion:  modpackMeta.loaderVersion,
      description:    modpackMeta.description,
      icon:           modpackMeta.icon || '📦',
      bannerColor:    modpackMeta.bannerColor || 'purple',
      featured:       modpackMeta.featured || false,
      totalMods:      totalMods,
      sizeMb:         archiveSizeMb,
      publishedAt:    new Date().toISOString(),

      // Одна ссылка на весь архив
      archiveUrl:     downloadUrl,
      archiveHash:    archiveHash,
      archiveExt:     ext,

      // Метаданные модов: иконки и сторона запуска
      mods: enrichedMods
    }

    // Добавляем или заменяем запись
    const idx = manifest.modpacks.findIndex(mp => mp.id === modpackEntry.id)
    if (idx >= 0) manifest.modpacks[idx] = modpackEntry
    else manifest.modpacks.push(modpackEntry)

    // Публикуем манифест
    await GitHubUploader.updateManifest(owner, repo, branch, manifest, sha)

    onStatus({
      step: 'done',
      message: `✅ "${modpackMeta.name}" v${modpackMeta.version} опубликована! (${archiveSizeMb} MB, ${totalMods} модов)`
    })

    return { success: true, totalMods, archiveSizeMb, modpackEntry }
  }

  // ── Патч: добавить .jar файлы в существующий архив на GitHub ────────────────
  async patchModpack(modpack, jarPaths, onStatus, onProgress) {
    if (!modpack.archiveUrl) {
      throw new Error('У сборки нет archiveUrl — переопубликуй её заново через Публикацию.')
    }
    if (!jarPaths || jarPaths.length === 0) {
      throw new Error('Не выбраны .jar файлы для добавления.')
    }

    const manifestUrl = Settings.get('manifestUrl')
    const { owner, repo } = GitHubUploader.parseRepo(manifestUrl)
    const branch = GitHubUploader.parseBranch(manifestUrl)

    onStatus({ step: 'download', message: `Скачиваем текущий архив сборки...` })

    // 1. Скачиваем текущий архив
    const ext = modpack.archiveExt || '.zip'
    const tmpArchive = require('path').join(require('os').tmpdir(), `craftsync-patch-${modpack.id}${ext}`)
    await this._downloadFile(modpack.archiveUrl, tmpArchive, (pct) => {
      onProgress({ overall: Math.round(pct * 0.3), silent: true })
    })

    onStatus({ step: 'patch', message: `Добавляем ${jarPaths.length} мод(ов) в архив...` })

    // 2. Добавляем .jar файлы в архив (только zip поддерживается)
    if (ext !== '.zip') {
      throw new Error('Патч поддерживается только для .zip архивов.')
    }

    const AdmZip = getAdmZip()
    const zip = new AdmZip(tmpArchive)

    // Удаляем старые версии добавляемых модов (если файл с тем же именем уже есть)
    for (const jarPath of jarPaths) {
      const jarName = require('path').basename(jarPath)
      const existing = zip.getEntry(jarName) || zip.getEntry(`mods/${jarName}`)
      if (existing) zip.deleteFile(existing)

      // Добавляем в корень (downloader.js сам раскладывает в mods/)
      zip.addLocalFile(jarPath)
      onStatus({ step: 'patch', message: `Добавлен: ${jarName}`, silent: true })
    }

    zip.writeZip(tmpArchive)

    onStatus({ step: 'hash', message: 'Вычисляем контрольную сумму...' })
    const newHash = await this._sha256(tmpArchive)
    const stat = await fs.stat(tmpArchive)
    const newSizeMb = parseFloat((stat.size / 1024 / 1024).toFixed(1))

    // 3. Загружаем обновлённый архив на GitHub (заменяем существующий)
    const archiveFilename = require('path').basename(modpack.archiveUrl.split('/').pop())
    onStatus({ step: 'upload', message: `Загружаем обновлённый архив (${newSizeMb} MB)...` })

    // Получаем/создаём релиз
    const tagName = `${modpack.id}-v${modpack.version}`
    const release = await GitHubUploader.ensureRelease(owner, repo, modpack.id, modpack.version,
      msg => onStatus({ step: 'github', message: msg, silent: true })
    )

    const downloadUrl = await GitHubUploader.uploadAsset(
      release, tmpArchive, archiveFilename,
      (pct) => {
        onProgress({ overall: 30 + Math.round(pct * 0.65), silent: true })
      }
    )

    // 4. Обновляем manifest.json
    onStatus({ step: 'manifest', message: 'Обновляем manifest.json...' })
    const { manifest, sha } = await GitHubUploader.fetchCurrentManifest(owner, repo, branch)

    const idx = manifest.modpacks.findIndex(mp => mp.id === modpack.id)
    if (idx >= 0) {
      manifest.modpacks[idx] = {
        ...manifest.modpacks[idx],
        archiveUrl:  downloadUrl,
        archiveHash: newHash,
        sizeMb:      newSizeMb,
        totalMods:   (manifest.modpacks[idx].totalMods || 0) + jarPaths.length,
        updatedAt:   new Date().toISOString()
      }
    }

    await GitHubUploader.updateManifest(owner, repo, branch, manifest, sha)

    // Чистим временный файл
    await fs.remove(tmpArchive).catch(() => {})

    onProgress({ overall: 100, silent: true })
    onStatus({
      step: 'done',
      message: `✅ Добавлено ${jarPaths.length} мод(ов) в "${modpack.name}"!`
    })

    return { success: true }
  }

  // ── Скачать файл для патча ────────────────────────────────────────────────
  async _downloadFile(url, dest, onPct) {
    const https = require('https')
    const http  = require('http')
    return new Promise((resolve, reject) => {
      const doReq = (u, redirects = 0) => {
        if (redirects > 10) return reject(new Error('Too many redirects'))
        const lib = u.startsWith('https') ? https : http
        lib.get(u, { headers: { 'User-Agent': 'CraftSync/0.1' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400) {
            res.resume()
            return doReq(res.headers.location, redirects + 1)
          }
          const total = parseInt(res.headers['content-length'] || '0')
          let done = 0
          const writer = require('fs').createWriteStream(dest)
          res.on('data', chunk => {
            done += chunk.length
            if (total) onPct(done / total)
          })
          res.pipe(writer)
          writer.on('finish', resolve)
          writer.on('error', reject)
          res.on('error', reject)
        }).on('error', reject)
      }
      doReq(url)
    })
  }

  // ── Modrinth API: получить метаданные по SHA1 хешам ──────────────────────
  async _lookupModrinth(hashes, hashToMod) {
    try {
      // Шаг 1: находим версии по SHA1
      const versionRes = await this._apiPost(
        'https://api.modrinth.com/v2/version_files',
        { hashes, algorithm: 'sha1' }
      )
      if (!versionRes || typeof versionRes !== 'object') return

      // Собираем уникальные project_id
      const projectIds = []
      const sha1ToProjectId = {}
      for (const [sha1, vdata] of Object.entries(versionRes)) {
        if (vdata && vdata.project_id) {
          sha1ToProjectId[sha1] = vdata.project_id
          if (!projectIds.includes(vdata.project_id)) projectIds.push(vdata.project_id)
        }
      }
      if (projectIds.length === 0) return

      // Шаг 2: получаем данные проектов (иконки + стороны)
      const projectsUrl = `https://api.modrinth.com/v2/projects?ids=${encodeURIComponent(JSON.stringify(projectIds))}`
      const projectsRes = await this._apiGet(projectsUrl)
      if (!Array.isArray(projectsRes)) return

      const projectById = {}
      for (const proj of projectsRes) {
        projectById[proj.id] = proj
      }

      // Шаг 3: обогащаем hashToMod
      for (const [sha1, projectId] of Object.entries(sha1ToProjectId)) {
        if (!hashToMod[sha1]) continue
        const proj = projectById[projectId]
        if (!proj) continue

        hashToMod[sha1].modrinthId  = proj.id
        hashToMod[sha1].displayName = proj.title || hashToMod[sha1].displayName
        hashToMod[sha1].iconUrl     = proj.icon_url || null
        hashToMod[sha1].side        = this._computeSide(proj.client_side, proj.server_side)
        hashToMod[sha1].source      = 'modrinth'
      }
    } catch (err) {
      console.error('[ModpackEditor] Modrinth lookup error:', err.message)
    }
  }

  // ── Определить сторону мода по данным Modrinth ────────────────────────────
  // client_side / server_side: "required" | "optional" | "unsupported"
  _computeSide(clientSide, serverSide) {
    if (clientSide === 'unsupported') return 'server'
    if (serverSide === 'unsupported') return 'client'
    return 'both'
  }

  // ── Очистить имя .jar файла в читаемое название ───────────────────────────
  _cleanModName(filename) {
    return filename
      .replace(/\.jar$/i, '')
      .replace(/[-_](mc|forge|fabric|neoforge)?[-_]?1\.\d+(\.\d+)?.*$/i, '')
      .replace(/[-_]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  // ── HTTP GET → JSON ───────────────────────────────────────────────────────
  _apiGet(url) {
    return new Promise((resolve, reject) => {
      const lib = url.startsWith('https') ? https : http
      lib.get(url, {
        headers: {
          'User-Agent': 'CraftSync/0.1 (github.com/craftsync)',
          'Accept': 'application/json'
        }
      }, (res) => {
        let body = ''
        res.on('data', c => body += c)
        res.on('end', () => {
          try { resolve(JSON.parse(body)) }
          catch { resolve(null) }
        })
        res.on('error', reject)
      }).on('error', reject)
    })
  }

  // ── HTTP POST JSON → JSON ─────────────────────────────────────────────────
  _apiPost(url, data) {
    return new Promise((resolve, reject) => {
      const body = JSON.stringify(data)
      const u = new URL(url)
      const options = {
        hostname: u.hostname,
        path:     u.pathname + u.search,
        method:   'POST',
        headers: {
          'User-Agent':   'CraftSync/0.1 (github.com/craftsync)',
          'Content-Type': 'application/json',
          'Accept':       'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      }
      const lib = url.startsWith('https') ? https : http
      const req = lib.request(options, (res) => {
        let resp = ''
        res.on('data', c => resp += c)
        res.on('end', () => {
          try { resolve(JSON.parse(resp)) }
          catch { resolve(null) }
        })
        res.on('error', reject)
      })
      req.on('error', reject)
      req.write(body)
      req.end()
    })
  }

  // ── SHA-256 файла ─────────────────────────────────────────────────────────
  async _sha256(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256')
      const stream = fs.createReadStream(filePath)
      stream.on('data', chunk => hash.update(chunk))
      stream.on('end', () => resolve(hash.digest('hex')))
      stream.on('error', reject)
    })
  }
}

module.exports = new ModpackEditor()
