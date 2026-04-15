/**
 * manifest.js — получение и кэширование списка сборок с GitHub.
 *
 * Поддерживает публичные и приватные репозитории:
 *  - Публичные: raw.githubusercontent.com (без токена)
 *  - Приватные: GitHub Contents API с токеном (если githubToken сохранён)
 *
 * manifestUrl можно указывать в любом формате:
 *   - https://github.com/user/repo/blob/main/manifest.json
 *   - https://raw.githubusercontent.com/user/repo/main/manifest.json
 *   - https://github.com/user/repo  (без файла — подставим /main/manifest.json)
 */

const axios = require('axios')
const path = require('path')
const fs = require('fs-extra')
const { app } = require('electron')
const Settings = require('./settings')

const CACHE_FILE     = path.join(app.getPath('userData'), 'manifest-cache.json')
const INSTALLED_FILE = path.join(app.getPath('userData'), 'installed.json')
const CACHE_TTL_MS   = 5 * 60 * 1000  // 5 минут

class ManifestManager {

  // ── Получить манифест с GitHub (с кэшем) ──────────────────────────────────
  async fetchManifest(forceRefresh = false) {
    const rawUrl = this._toRawUrl(Settings.get('manifestUrl'))

    if (!rawUrl) {
      console.log('[Manifest] URL не настроен — демо-режим')
      return this._getDemoManifest()
    }

    // Проверяем кэш
    if (!forceRefresh) {
      const cached = this._loadCache()
      if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        console.log('[Manifest] Из кэша')
        return cached.data
      }
    }

    console.log('[Manifest] Загружаем:', rawUrl)

    // Сначала пробуем напрямую (для публичных репо)
    try {
      const manifest = await this._fetchDirect(rawUrl)
      this._saveCache(manifest)
      console.log(`[Manifest] Загружено сборок: ${manifest.modpacks?.length || 0}`)
      return manifest
    } catch (directErr) {
      console.log(`[Manifest] Прямой запрос неудачен (${directErr.response?.status || directErr.message}), пробуем через API...`)
    }

    // Если 404/403 — пробуем через GitHub Contents API с токеном
    try {
      const manifest = await this._fetchViaApi(rawUrl)
      this._saveCache(manifest)
      console.log(`[Manifest] Загружено через API: ${manifest.modpacks?.length || 0} сборок`)
      return manifest
    } catch (apiErr) {
      console.error('[Manifest] API тоже не сработал:', apiErr.message)

      // Отдаём устаревший кэш если есть
      const cached = this._loadCache()
      if (cached) {
        console.log('[Manifest] Отдаём кэш')
        return { ...cached.data, fromCache: true }
      }

      // Подробная ошибка
      if (apiErr.response?.status === 404) {
        throw new Error(
          'manifest.json не найден на GitHub (404).\n' +
          'Проверь:\n' +
          '1. Репозиторий существует: github.com/ffxlino/CMML\n' +
          '2. Файл manifest.json есть в корне репозитория\n' +
          '3. Если репо приватное — укажи GitHub Token в настройках'
        )
      }
      if (apiErr.response?.status === 401 || apiErr.response?.status === 403) {
        throw new Error(
          'Нет доступа к репозиторию (401/403).\n' +
          'Если репозиторий приватный — укажи GitHub Token в Настройках → Публикация.'
        )
      }

      throw new Error(`Не удалось загрузить манифест: ${apiErr.message}`)
    }
  }

  // ── Прямой GET (для публичных репо) ───────────────────────────────────────
  async _fetchDirect(rawUrl) {
    const res = await axios.get(rawUrl, {
      timeout: 15000,
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
    })
    const manifest = res.data
    this._validateManifest(manifest)
    return manifest
  }

  // ── GitHub Contents API (для приватных репо) ───────────────────────────────
  async _fetchViaApi(rawUrl) {
    const { owner, repo, branch, filePath } = this._parseRawUrl(rawUrl)
    const token = Settings.get('githubToken')

    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}?ref=${branch}`
    console.log('[Manifest] GitHub API:', apiUrl)

    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'CraftSync-Launcher'
    }
    if (token) headers['Authorization'] = `token ${token}`

    const res = await axios.get(apiUrl, { headers, timeout: 15000 })

    // Декодируем base64
    const content = res.data.content.replace(/\n/g, '').replace(/\r/g, '')
    const json = Buffer.from(content, 'base64').toString('utf-8')
    const manifest = JSON.parse(json)
    this._validateManifest(manifest)
    return manifest
  }

  // ── Парсинг raw URL → { owner, repo, branch, filePath } ───────────────────
  _parseRawUrl(rawUrl) {
    // https://raw.githubusercontent.com/owner/repo/branch/path/to/file.json
    const m = rawUrl.match(
      /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/
    )
    if (!m) throw new Error(`Не удалось разобрать URL: ${rawUrl}`)
    return { owner: m[1], repo: m[2], branch: m[3], filePath: m[4] }
  }

  // ── Конвертировать любой GitHub URL в raw-формат ──────────────────────────
  _toRawUrl(url) {
    if (!url || url.trim() === '') return null
    url = url.trim()

    // Уже raw
    if (url.startsWith('https://raw.githubusercontent.com/')) return url

    // github.com/user/repo/blob/branch/file или /raw/branch/file
    const blobMatch = url.match(
      /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/(blob|raw)\/(.+)$/
    )
    if (blobMatch) {
      const [, owner, repo, , rest] = blobMatch
      return `https://raw.githubusercontent.com/${owner}/${repo}/${rest}`
    }

    // github.com/user/repo  (только репозиторий — добавляем /main/manifest.json)
    const repoMatch = url.match(/^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/?$/)
    if (repoMatch) {
      const [, owner, repo] = repoMatch
      return `https://raw.githubusercontent.com/${owner}/${repo}/main/manifest.json`
    }

    return url
  }

  // ── Валидация структуры манифеста ─────────────────────────────────────────
  _validateManifest(manifest) {
    if (!manifest || typeof manifest !== 'object') {
      throw new Error('Манифест — не JSON-объект')
    }
    if (!Array.isArray(manifest.modpacks)) {
      throw new Error('В манифесте нет поля "modpacks" (массив)')
    }
  }

  // ── Сброс кэша ────────────────────────────────────────────────────────────
  clearCache() {
    try { fs.removeSync(CACHE_FILE) } catch { /* ignore */ }
  }

  // ── Установленные сборки ───────────────────────────────────────────────────
  getInstalledModpacks() {
    try {
      if (fs.existsSync(INSTALLED_FILE)) {
        return JSON.parse(fs.readFileSync(INSTALLED_FILE, 'utf-8'))
      }
    } catch (err) {
      console.error('[Manifest] Ошибка чтения installed.json:', err.message)
    }
    return {}
  }

  markInstalled(modpackId, version) {
    const installed = this.getInstalledModpacks()
    installed[modpackId] = { version, installedAt: new Date().toISOString() }
    fs.writeFileSync(INSTALLED_FILE, JSON.stringify(installed, null, 2))
  }

  markUninstalled(modpackId) {
    const installed = this.getInstalledModpacks()
    delete installed[modpackId]
    fs.writeFileSync(INSTALLED_FILE, JSON.stringify(installed, null, 2))
  }

  updatePlayStats(modpackId, minutesPlayed) {
    const installed = this.getInstalledModpacks()
    if (!installed[modpackId]) return
    installed[modpackId].lastPlayed = new Date().toISOString()
    installed[modpackId].totalPlayMinutes =
      (installed[modpackId].totalPlayMinutes || 0) + minutesPlayed
    fs.writeFileSync(INSTALLED_FILE, JSON.stringify(installed, null, 2))
  }

  // ── Приватные ──────────────────────────────────────────────────────────────
  _loadCache() {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        return JSON.parse(fs.readFileSync(CACHE_FILE, 'utf-8'))
      }
    } catch { /* игнор */ }
    return null
  }

  _saveCache(data) {
    try {
      fs.writeFileSync(CACHE_FILE, JSON.stringify({ fetchedAt: Date.now(), data }, null, 2))
    } catch (e) {
      console.error('[Manifest] Не удалось сохранить кэш:', e.message)
    }
  }

  _getDemoManifest() {
    return {
      version: '1.0.0',
      isDemo: true,
      modpacks: [
        {
          id: 'demo-pack',
          name: 'Demo Pack',
          version: '1.0.0',
          mcVersion: '1.20.1',
          loader: 'forge',
          description: 'Укажи URL своего manifest.json в Настройках → URL манифеста.',
          icon: '📦',
          bannerColor: 'purple',
          featured: true,
          totalMods: 0,
          sizeMb: 0
        }
      ]
    }
  }
}

module.exports = new ManifestManager()
