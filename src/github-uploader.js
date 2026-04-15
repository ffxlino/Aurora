/**
 * github-uploader.js — загрузка модов и обновление манифеста через GitHub API.
 *
 * Для работы нужен GitHub Personal Access Token с правами:
 *   - repo (полный доступ к приватным и публичным репозиториям)
 *
 * Как получить токен:
 *   GitHub → Settings → Developer settings → Personal access tokens → Generate new token
 */

const axios = require('axios')
const fs = require('fs-extra')
const path = require('path')
const Settings = require('./settings')

class GitHubUploader {

  // ── Парсим owner/repo из URL манифеста ────────────────────────────────────
  parseRepo(manifestUrl) {
    // Поддерживаем форматы:
    // https://raw.githubusercontent.com/owner/repo/branch/manifest.json
    // https://github.com/owner/repo
    const rawMatch = manifestUrl.match(/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)/)
    if (rawMatch) return { owner: rawMatch[1], repo: rawMatch[2] }

    const ghMatch = manifestUrl.match(/github\.com\/([^/]+)\/([^/]+)/)
    if (ghMatch) return { owner: ghMatch[1], repo: ghMatch[2] }

    throw new Error(
      'Не удалось определить репозиторий из URL манифеста.\n' +
      'Формат: https://raw.githubusercontent.com/ВАШ_НИК/РЕПО/main/manifest.json'
    )
  }

  // ── Определяем ветку из URL ────────────────────────────────────────────────
  parseBranch(manifestUrl) {
    const match = manifestUrl.match(/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/([^/]+)/)
    return match ? match[1] : 'main'
  }

  // ── Заголовки авторизации ─────────────────────────────────────────────────
  _headers() {
    const token = Settings.get('githubToken')
    if (!token) throw new Error('GitHub токен не настроен. Укажите его в Настройках.')
    return {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'CraftSync-Launcher/0.1'
    }
  }

  // ── Проверить токен ────────────────────────────────────────────────────────
  async validateToken() {
    try {
      const res = await axios.get('https://api.github.com/user', {
        headers: this._headers(),
        timeout: 10000
      })
      return { ok: true, login: res.data.login }
    } catch (err) {
      if (err.response?.status === 401) {
        return { ok: false, error: 'Неверный токен' }
      }
      return { ok: false, error: err.message }
    }
  }

  // ── Создать или получить Release для версии сборки ────────────────────────
  async ensureRelease(owner, repo, modpackId, version, onStatus) {
    const tag = `${modpackId}-v${version}`
    const headers = this._headers()

    onStatus(`Проверяем релиз ${tag}...`)

    try {
      const res = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`,
        { headers, timeout: 15000 }
      )
      onStatus(`Используем существующий релиз: ${tag}`)
      return res.data
    } catch (err) {
      if (err.response?.status !== 404) throw err
    }

    // Создаём новый релиз
    onStatus(`Создаём релиз ${tag}...`)
    const res = await axios.post(
      `https://api.github.com/repos/${owner}/${repo}/releases`,
      {
        tag_name: tag,
        name: `${modpackId} v${version}`,
        body: `Сборка ${modpackId} версии ${version}, опубликована через CraftSync Launcher.`,
        draft: false,
        prerelease: false
      },
      { headers, timeout: 15000 }
    )
    onStatus(`Релиз создан: ${tag}`)
    return res.data
  }

  // ── Загрузить файл в Release ──────────────────────────────────────────────
  async uploadAsset(release, filePath, fileName, onProgress) {
    const headers = this._headers()
    const fileSize = fs.statSync(filePath).size

    // Удаляем старый файл с тем же именем — иначе GitHub вернёт 422
    const existing = release.assets?.find(a => a.name === fileName)
    if (existing) {
      console.log(`[GitHub] Удаляем старый ассет: ${fileName}`)
      try {
        await axios.delete(existing.url, { headers, timeout: 15000 })
        // Небольшая пауза после удаления — GitHub иногда кэширует
        await new Promise(r => setTimeout(r, 1500))
      } catch (e) {
        console.warn('[GitHub] Не удалось удалить старый ассет:', e.message)
      }
    }

    // Для больших файлов читаем стримом, не всё в память сразу
    const fileStream = fs.createReadStream(filePath)
    const uploadUrl = release.upload_url.replace('{?name,label}', '')

    // Определяем content-type по расширению
    const ext = path.extname(fileName).toLowerCase()
    const contentType = ext === '.zip' ? 'application/zip'
      : ext === '.rar' ? 'application/x-rar-compressed'
      : ext === '.7z'  ? 'application/x-7z-compressed'
      : 'application/octet-stream'

    let uploaded = 0
    fileStream.on('data', chunk => {
      uploaded += chunk.length
      if (onProgress && fileSize > 0) {
        onProgress(Math.round((uploaded / fileSize) * 100))
      }
    })

    const res = await axios.post(
      `${uploadUrl}?name=${encodeURIComponent(fileName)}`,
      fileStream,
      {
        headers: {
          ...headers,
          'Content-Type': contentType,
          'Content-Length': fileSize
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 1800000  // 30 минут для больших архивов
      }
    )

    return res.data.browser_download_url
  }

  // ── Получить текущий манифест из GitHub ───────────────────────────────────
  async fetchCurrentManifest(owner, repo, branch) {
    const headers = this._headers()
    try {
      const res = await axios.get(
        `https://api.github.com/repos/${owner}/${repo}/contents/manifest.json`,
        { headers, params: { ref: branch }, timeout: 15000 }
      )
      // GitHub API возвращает base64 с символами переноса строки — убираем их
      const rawContent = res.data.content.replace(/\n/g, '').replace(/\r/g, '')
      const content = Buffer.from(rawContent, 'base64').toString('utf-8')

      // Защита от пустого файла
      if (!content.trim()) {
        return {
          manifest: { version: '1.0.0', updatedAt: new Date().toISOString(), modpacks: [] },
          sha: res.data.sha
        }
      }

      return { manifest: JSON.parse(content), sha: res.data.sha }
    } catch (err) {
      if (err.response?.status === 404) {
        // Файла нет — создадим новый манифест
        return {
          manifest: { version: '1.0.0', updatedAt: new Date().toISOString(), modpacks: [] },
          sha: null
        }
      }
      throw err
    }
  }

  // ── Обновить manifest.json в репозитории ─────────────────────────────────
  async updateManifest(owner, repo, branch, manifest, sha) {
    const headers = this._headers()
    manifest.updatedAt = new Date().toISOString()

    const content = Buffer.from(JSON.stringify(manifest, null, 2)).toString('base64')

    await axios.put(
      `https://api.github.com/repos/${owner}/${repo}/contents/manifest.json`,
      {
        message: `[CraftSync] Update manifest — ${new Date().toLocaleString('ru')}`,
        content,
        branch,
        ...(sha ? { sha } : {})
      },
      { headers, timeout: 15000 }
    )
  }
}

module.exports = new GitHubUploader()
