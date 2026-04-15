/**
 * forge-installer.js — автоматическая установка Forge / Fabric / Quilt / NeoForge.
 *
 * Поток для Forge:
 *  1. Скачиваем официальный forge-installer.jar с maven.minecraftforge.net
 *  2. Находим Java (сначала bundled JRE от Minecraft, потом системную)
 *  3. Запускаем installer headlessly: java -jar forge-installer.jar --installClient <dir>
 *  4. Installer сам скачивает vanilla MC + библиотеки + создаёт профиль в versions/
 *
 * Поток для Fabric:
 *  1. Скачиваем fabric-installer.jar
 *  2. java -jar fabric-installer.jar client -mcversion ... -loader ... -dir ...
 */

const path = require('path')
const fs = require('fs-extra')
const https = require('https')
const http = require('http')
const { spawn } = require('child_process')
const os = require('os')
const { app } = require('electron')
const Logger = require('./logger')

// Папка для кэша installer-JAR файлов
const INSTALLER_CACHE_DIR = path.join(app.getPath('userData'), 'installer-cache')

class ForgeInstaller {

  // ── Главный метод — проверить и установить если нужно ────────────────────
  async ensureLoaderInstalled(meta, minecraftRoot, onProgress) {
    if (!meta.loader || meta.loader === 'vanilla') return

    const versionId = this._getVersionId(meta)
    const versionJson = path.join(minecraftRoot, 'versions', versionId, `${versionId}.json`)

    if (fs.existsSync(versionJson)) {
      Logger.session(`[ForgeInstaller] ${versionId} уже установлен`)
      return
    }

    Logger.session(`[ForgeInstaller] Устанавливаем ${versionId}...`)
    onProgress({ step: 'forge-check', message: `Устанавливаем ${meta.loader} ${meta.loaderVersion}...`, percent: 0 })

    await fs.ensureDir(minecraftRoot)

    switch (meta.loader) {
      case 'forge':    await this._installForge(meta, minecraftRoot, onProgress); break
      case 'fabric':   await this._installFabric(meta, minecraftRoot, onProgress); break
      case 'quilt':    await this._installQuilt(meta, minecraftRoot, onProgress); break
      case 'neoforge': await this._installNeoForge(meta, minecraftRoot, onProgress); break
      default: throw new Error(`Неизвестный загрузчик: ${meta.loader}`)
    }

    onProgress({ step: 'forge-done', message: `✅ ${meta.loader} ${meta.loaderVersion} установлен!`, percent: 100 })
    Logger.session(`[ForgeInstaller] Готово: ${versionId}`)
  }

  // ── Создать launcher_profiles.json если отсутствует ──────────────────────
  // Forge installer требует этот файл иначе падает с ошибкой
  async _ensureLauncherProfiles(minecraftRoot) {
    const profilesPath = path.join(minecraftRoot, 'launcher_profiles.json')
    if (!fs.existsSync(profilesPath)) {
      Logger.session('[ForgeInstaller] Создаём launcher_profiles.json...')
      const minimal = {
        profiles: {},
        settings: {
          enableAdvancedSettings: false,
          profileSorting: 'ByLastPlayed'
        },
        version: 3
      }
      await fs.ensureDir(minecraftRoot)
      fs.writeFileSync(profilesPath, JSON.stringify(minimal, null, 2))
    }
  }

  // ── Кэш installer-JAR ────────────────────────────────────────────────────
  // Возвращает путь к JAR: либо уже скачанный, либо скачивает заново.
  async _getCachedJar(jarName, url, onProgress) {
    await fs.ensureDir(INSTALLER_CACHE_DIR)
    const cached = path.join(INSTALLER_CACHE_DIR, jarName)

    if (await fs.pathExists(cached)) {
      Logger.session(`[ForgeInstaller] Используем кэш: ${jarName}`)
      onProgress({ message: `Используем кэшированный installer...`, percent: 40 })
      return cached
    }

    Logger.session(`[ForgeInstaller] Скачиваем: ${jarName}`)
    await this._download(url, cached, (pct) => {
      onProgress({ message: `Скачиваем installer... ${pct}%`, percent: Math.round(pct * 0.4) })
    })
    return cached
  }

  // ── Forge ─────────────────────────────────────────────────────────────────
  async _installForge(meta, minecraftRoot, onProgress) {
    await this._ensureLauncherProfiles(minecraftRoot)
    const ver = `${meta.mcVersion}-${meta.loaderVersion}`
    const jarName = `forge-${ver}-installer.jar`
    const url = `https://maven.minecraftforge.net/net/minecraftforge/forge/${ver}/${jarName}`

    const jarPath = await this._getCachedJar(jarName, url, (p) =>
      onProgress({ step: 'forge-dl', ...p })
    )

    const javaPath = await this._findJava(minecraftRoot)
    Logger.session(`[ForgeInstaller] Java: ${javaPath}`)
    onProgress({ step: 'forge-install', message: 'Устанавливаем Forge (может занять 3-10 минут)...', percent: 42 })

    await this._runJar(javaPath, jarPath, [
      '--installClient', minecraftRoot
    ], minecraftRoot, (line) => {
      Logger.session('[Forge] ' + line)
      if (line.includes('Downloading') || line.includes('Installing') || line.includes('ERROR') || line.includes('error')) {
        onProgress({ step: 'forge-install', message: line.slice(0, 80), percent: 70 })
      }
    })
  }

  // ── Fabric ────────────────────────────────────────────────────────────────
  async _installFabric(meta, minecraftRoot, onProgress) {
    await this._ensureLauncherProfiles(minecraftRoot)
    const installerVersion = await this._getLatestFabricInstaller()
    const jarName = `fabric-installer-${installerVersion}.jar`
    const url = `https://maven.fabricmc.net/net/fabricmc/fabric-installer/${installerVersion}/${jarName}`

    const jarPath = await this._getCachedJar(jarName, url, (p) =>
      onProgress({ step: 'fabric-dl', ...p })
    )

    const javaPath = await this._findJava(minecraftRoot)
    onProgress({ step: 'fabric-install', message: 'Устанавливаем Fabric...', percent: 42 })

    await this._runJar(javaPath, jarPath, [
      'client',
      '-mcversion', meta.mcVersion,
      '-loader', meta.loaderVersion,
      '-dir', minecraftRoot,
      '-noprofile'
    ], minecraftRoot, (line) => {
      Logger.session('[Fabric] ' + line)
      onProgress({ step: 'fabric-install', message: line.slice(0, 80), percent: 70 })
    })
  }

  // ── NeoForge ──────────────────────────────────────────────────────────────
  async _installNeoForge(meta, minecraftRoot, onProgress) {
    await this._ensureLauncherProfiles(minecraftRoot)
    const ver = meta.loaderVersion
    const jarName = `neoforge-${ver}-installer.jar`
    const url = `https://maven.neoforged.net/releases/net/neoforged/neoforge/${ver}/${jarName}`

    const jarPath = await this._getCachedJar(jarName, url, (p) =>
      onProgress({ step: 'neo-dl', ...p })
    )

    const javaPath = await this._findJava(minecraftRoot)
    onProgress({ step: 'neo-install', message: 'Устанавливаем NeoForge...', percent: 42 })

    await this._runJar(javaPath, jarPath, [
      '--installClient', minecraftRoot
    ], minecraftRoot, (line) => {
      Logger.session('[NeoForge] ' + line)
      onProgress({ step: 'neo-install', message: line.slice(0, 80), percent: 70 })
    })
  }

  // ── Quilt ─────────────────────────────────────────────────────────────────
  async _installQuilt(meta, minecraftRoot, onProgress) {
    await this._ensureLauncherProfiles(minecraftRoot)
    const installerVersion = '0.9.1'
    const jarName = `quilt-installer-${installerVersion}.jar`
    const url = `https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/${installerVersion}/${jarName}`

    const jarPath = await this._getCachedJar(jarName, url, (p) =>
      onProgress({ step: 'quilt-dl', ...p })
    )

    const javaPath = await this._findJava(minecraftRoot)
    onProgress({ step: 'quilt-install', message: 'Устанавливаем Quilt...', percent: 42 })

    await this._runJar(javaPath, jarPath, [
      'install', 'client', meta.mcVersion, meta.loaderVersion,
      '--install-dir', minecraftRoot,
      '--no-profile'
    ], minecraftRoot, (line) => {
      Logger.session('[Quilt] ' + line)
    })
  }

  // ── Найти Java ────────────────────────────────────────────────────────────
  async _findJava(minecraftRoot) {
    const isWin = process.platform === 'win32'
    const exe = isWin ? 'java.exe' : 'java'

    // 1. Bundled JRE от официального Minecraft лаунчера
    const runtimes = ['java-runtime-gamma', 'java-runtime-delta', 'java-runtime-beta', 'java-runtime-alpha', 'jre-legacy']
    const osPlatform = isWin ? 'windows-x64' : (process.platform === 'darwin' ? 'mac-os-arm64' : 'linux')

    for (const runtime of runtimes) {
      const candidates = [
        path.join(minecraftRoot, 'runtime', runtime, osPlatform, runtime, 'bin', exe),
        path.join(minecraftRoot, 'runtime', runtime, 'windows-x64', runtime, 'bin', exe),
        path.join(minecraftRoot, 'runtime', runtime, runtime, 'bin', exe),
      ]
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          Logger.session(`[Java] Найдена bundled: ${p}`)
          return p
        }
      }
    }

    // 2. JAVA_HOME
    if (process.env.JAVA_HOME) {
      const p = path.join(process.env.JAVA_HOME, 'bin', exe)
      if (fs.existsSync(p)) return p
    }

    // 3. Распространённые пути Windows
    if (isWin) {
      const roots = [
        'C:\\Program Files\\Java',
        'C:\\Program Files\\Eclipse Adoptium',
        'C:\\Program Files\\Microsoft',
        'C:\\Program Files\\Zulu',
        'C:\\Program Files\\BellSoft',
        path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Java'),
      ]
      for (const root of roots) {
        if (!fs.existsSync(root)) continue
        const dirs = fs.readdirSync(root).sort().reverse() // берём новейшую версию
        for (const dir of dirs) {
          const p = path.join(root, dir, 'bin', exe)
          if (fs.existsSync(p)) {
            Logger.session(`[Java] Найдена системная: ${p}`)
            return p
          }
        }
      }
    }

    // 4. Пробуем просто 'java' из PATH
    const ok = await this._testJava('java')
    if (ok) return 'java'

    throw new Error(
      'Java не найдена!\n\n' +
      'Установи Java 17 (бесплатно):\n' +
      'https://adoptium.net/temurin/releases/?version=17\n\n' +
      'После установки перезапусти CraftSync.'
    )
  }

  _testJava(javaPath) {
    return new Promise((resolve) => {
      const p = spawn(javaPath, ['-version'], { stdio: 'pipe' })
      p.on('close', (code) => resolve(code === 0))
      p.on('error', () => resolve(false))
      setTimeout(() => { p.kill(); resolve(false) }, 5000)
    })
  }

  // ── Запустить JAR ─────────────────────────────────────────────────────────
  _runJar(javaPath, jarPath, args, cwd, onLine) {
    return new Promise((resolve, reject) => {
      const proc = spawn(javaPath, [
        '-Djava.awt.headless=true',  // без GUI
        '-jar', jarPath,
        ...args
      ], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe']
      })

      const handle = (data) => {
        data.toString().split('\n').forEach(line => {
          line = line.trim()
          if (line) onLine(line)
        })
      }

      proc.stdout.on('data', handle)
      proc.stderr.on('data', handle)

      proc.on('close', (code) => {
        if (code === 0 || code === null) resolve()
        else reject(new Error(`Installer завершился с кодом ${code}. Смотри logs/latest.txt`))
      })

      proc.on('error', (err) => {
        reject(new Error(`Не удалось запустить Java: ${err.message}`))
      })
    })
  }

  // ── Скачать файл ──────────────────────────────────────────────────────────
  _download(url, dest, onPct) {
    return new Promise((resolve, reject) => {
      const doReq = (u, redirects = 0) => {
        if (redirects > 10) return reject(new Error('Слишком много редиректов'))
        const lib = u.startsWith('https') ? https : http
        lib.get(u, { headers: { 'User-Agent': 'CraftSync/0.1' } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400) {
            res.resume()
            return doReq(res.headers.location, redirects + 1)
          }
          if (res.statusCode !== 200) {
            res.resume()
            return reject(new Error(`HTTP ${res.statusCode} при скачивании ${path.basename(dest)}`))
          }
          const total = parseInt(res.headers['content-length'] || '0')
          let done = 0
          const writer = fs.createWriteStream(dest)
          res.on('data', chunk => {
            done += chunk.length
            if (total > 0 && onPct) onPct(Math.round((done / total) * 100))
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

  // ── Получить последнюю версию Fabric installer ─────────────────────────────
  async _getLatestFabricInstaller() {
    try {
      const axios = require('axios')
      const res = await axios.get('https://meta.fabricmc.net/v2/versions/installer', { timeout: 10000 })
      const stable = res.data.find(v => v.stable)
      return stable?.version || '1.0.1'
    } catch {
      return '1.0.1'  // fallback
    }
  }

  // ── ID версии в .minecraft/versions/ ─────────────────────────────────────
  _getVersionId(meta) {
    switch (meta.loader) {
      case 'forge':    return `${meta.mcVersion}-forge-${meta.loaderVersion}`
      case 'fabric':   return `fabric-loader-${meta.loaderVersion}-${meta.mcVersion}`
      case 'quilt':    return `quilt-loader-${meta.loaderVersion}-${meta.mcVersion}`
      case 'neoforge': return `${meta.mcVersion}-neoforge-${meta.loaderVersion}`
      default:         return meta.mcVersion
    }
  }
}

module.exports = new ForgeInstaller()
