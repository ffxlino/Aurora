/**
 * launcher.js — запуск Minecraft с нужной сборкой.
 *
 * Логика:
 *  1. Используем СУЩЕСТВУЮЩИЙ .minecraft (там уже скачаны assets, libraries, Forge)
 *  2. Наша папка сборки = только моды и конфиги (gameDirectory)
 *  3. Перед запуском проверяем что нужная версия Forge/Fabric установлена
 *  4. Если нет — показываем чёткую ошибку с инструкцией
 */

const { Client, Authenticator } = require('minecraft-launcher-core')
const path = require('path')
const fs = require('fs-extra')
const os = require('os')
const Settings = require('./settings')
const ManifestManager = require('./manifest')
const Auth = require('./auth')
const Logger = require('./logger')
const ForgeInstaller = require('./forge-installer')

class GameLauncher {
  constructor() {
    this.client = new Client()
  }

  async launch(modpackId, settings, onStatus) {
    const installed = ManifestManager.getInstalledModpacks()
    if (!installed[modpackId]) throw new Error('Сборка не установлена.')

    const meta = this._loadModpackMeta(modpackId)
    if (!meta) throw new Error('Метаданные сборки не найдены. Переустановите её.')

    // Папки
    const minecraftRoot = settings.minecraftPath || this._getDefaultMinecraftPath()
    const modpackDir    = path.join(settings.gamePath, 'modpacks', modpackId)
    const modsDir       = path.join(modpackDir, 'mods')

    Logger.session(`\n=== Запуск: ${meta.name} v${meta.version} ===`)
    Logger.session(`Minecraft root: ${minecraftRoot}`)
    Logger.session(`Modpack dir:    ${modpackDir}`)

    onStatus({ status: 'starting', message: 'Проверяем установку Minecraft...' })

    // Создаём .minecraft если не существует (ForgeInstaller сам всё скачает)
    await fs.ensureDir(minecraftRoot)

    // Автоматически устанавливаем Forge/Fabric если отсутствует
    try {
      await ForgeInstaller.ensureLoaderInstalled(meta, minecraftRoot, (data) => {
        onStatus({ status: 'installing', message: data.message, percent: data.percent })
      })
    } catch (err) {
      Logger.error('ForgeInstaller', err)
      throw new Error(`Ошибка установки ${meta.loader}: ${err.message}`)
    }

    const loaderVersionId = this._getLoaderVersionId(meta)
    Logger.session(`Версия OK: ${loaderVersionId || meta.mcVersion}`)
    onStatus({ status: 'starting', message: `${meta.loader || 'Vanilla'} готов ✓` })

    // Убеждаемся что папка модов существует
    await fs.ensureDir(modsDir)

    // Авторизация
    let auth
    if (settings.authType === 'microsoft' && settings.mcToken) {
      onStatus({ status: 'starting', message: 'Проверяем Microsoft токен...' })
      const refreshed = await Auth.refreshIfNeeded()
      if (refreshed) {
        auth = {
          access_token:    refreshed.access_token,
          client_token:    settings.uuid || 'craftsync',
          uuid:            settings.uuid,
          name:            settings.username,
          user_properties: '{}'
        }
        Logger.session(`Auth: Microsoft (${settings.username})`)
        onStatus({ status: 'starting', message: `Аккаунт: ${settings.username} (Microsoft)` })
      } else {
        auth = Authenticator.getAuth(settings.username || 'Player')
        Logger.session(`Auth: offline fallback (${settings.username})`)
        onStatus({ status: 'starting', message: `Аккаунт: ${settings.username} (офлайн — токен истёк)` })
      }
    } else {
      auth = Authenticator.getAuth(settings.username || 'Player')
      Logger.session(`Auth: offline (${settings.username})`)
      onStatus({ status: 'starting', message: `Аккаунт: ${settings.username} (офлайн)` })
    }

    // Forge/NeoForge 1.16.5+ требуют JVM аргументы из версионного JSON
    // MCLC не читает arguments.jvm из кастомной версии — делаем это сами
    const isForge = meta.loader === 'forge' || meta.loader === 'neoforge'
    const forgeJvmArgs = isForge
      ? this._buildForgeJvmArgs(minecraftRoot, loaderVersionId)
      : []

    const launchOptions = {
      authorization: auth,

      // root = .minecraft (там уже есть versions, assets, libraries)
      root: minecraftRoot,

      version: {
        number: meta.mcVersion,
        type:   'release',
        ...(loaderVersionId ? { custom: loaderVersionId } : {})
      },

      memory: {
        min: `${settings.minRam || 1024}M`,
        max: `${settings.maxRam || 4096}M`
      },

      window: {
        width:      settings.gameWidth  || 1280,
        height:     settings.gameHeight || 720,
        fullscreen: !!settings.fullscreen
      },

      ...(settings.javaPath ? { javaPath: settings.javaPath } : {}),

      // Кастомные JVM аргументы из настроек пользователя
      ...(() => {
        const extraJvmArgs = (settings.jvmArgs || '').trim().split(/\s+/).filter(Boolean)
        const combined = [...forgeJvmArgs, ...extraJvmArgs]
        return combined.length > 0 ? { customArgs: combined } : {}
      })(),

      overrides: {
        // gameDirectory = папка сборки (там лежат mods/, config/ и т.д.)
        gameDirectory: modpackDir
      }
    }

    Logger.session(`Launch options: mc=${meta.mcVersion} loader=${loaderVersionId || 'vanilla'} ram=${settings.maxRam}M`)
    if (forgeJvmArgs.length > 0) {
      Logger.session(`[Launcher] Forge JVM args (${forgeJvmArgs.length}): ${forgeJvmArgs.slice(0, 6).join(' ')}...`)
    }

    this.client.removeAllListeners()

    this.client.on('debug', (msg) => {
      const line = (msg || '').toString().trim()
      if (line) Logger.session('[D] ' + line)
    })

    this.client.on('data', (msg) => {
      const line = (msg || '').toString().trim()
      if (line) {
        Logger.session(line)
        onStatus({ status: 'running', message: line })
      }
    })

    this.client.on('progress', (p) => {
      const pct = p.total > 0 ? Math.round((p.task / p.total) * 100) : 0
      onStatus({ status: 'loading', message: `${p.type}: ${pct}%`, percent: pct })
    })

    this.client.on('close', (code) => {
      Logger.session(`[CLOSE] код: ${code}`)
      onStatus({ status: 'closed', message: 'Игра завершена', code })
    })

    try {
      await this.client.launch(launchOptions)
      Logger.session('[OK] Игра запущена')
      onStatus({ status: 'launched', message: `${meta.name} запущен!` })
    } catch (err) {
      Logger.session('[ERROR] ' + err.message)
      throw err
    }
  }

  // ── Авто-определение пути .minecraft ──────────────────────────────────────
  _getDefaultMinecraftPath() {
    switch (process.platform) {
      case 'win32':  return path.join(os.homedir(), 'AppData', 'Roaming', '.minecraft')
      case 'darwin': return path.join(os.homedir(), 'Library', 'Application Support', 'minecraft')
      default:       return path.join(os.homedir(), '.minecraft')
    }
  }

  // ── ID версии загрузчика (как он называется в .minecraft/versions/) ───────
  _getLoaderVersionId(meta) {
    if (!meta.loader || meta.loader === 'vanilla') return undefined
    switch (meta.loader) {
      case 'forge':    return `${meta.mcVersion}-forge-${meta.loaderVersion}`
      case 'fabric':   return `fabric-loader-${meta.loaderVersion}-${meta.mcVersion}`
      case 'quilt':    return `quilt-loader-${meta.loaderVersion}-${meta.mcVersion}`
      case 'neoforge': return `${meta.mcVersion}-neoforge-${meta.loaderVersion}`
      default:         return undefined
    }
  }

  _loadModpackMeta(modpackId) {
    const metaPath = path.join(Settings.get('gamePath'), 'modpacks', modpackId, 'craftsync-meta.json')
    try {
      if (fs.existsSync(metaPath)) return JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
    } catch (err) {
      Logger.error('loadModpackMeta', err)
    }
    return null
  }

  /**
   * Читает JVM-аргументы из версионного JSON Forge/NeoForge.
   * MCLC не обрабатывает arguments.jvm из кастомных версий, поэтому
   * делаем это вручную — особенно важны -p (module path) и --add-modules.
   */
  _buildForgeJvmArgs(minecraftRoot, loaderVersionId) {
    if (!loaderVersionId) return []

    const versionJsonPath = path.join(
      minecraftRoot, 'versions', loaderVersionId, `${loaderVersionId}.json`
    )
    if (!fs.existsSync(versionJsonPath)) {
      Logger.session('[Launcher] Версионный JSON не найден: ' + versionJsonPath)
      return this._fallbackForgeJvmArgs()
    }

    let versionJson
    try {
      versionJson = JSON.parse(fs.readFileSync(versionJsonPath, 'utf-8'))
    } catch (e) {
      Logger.session('[Launcher] Ошибка чтения версионного JSON: ' + e.message)
      return this._fallbackForgeJvmArgs()
    }

    const rawArgs = versionJson.arguments?.jvm || []
    const libraryDir = path.join(minecraftRoot, 'libraries')
    const resolved = []

    // Флаги, после которых значение содержит файловые пути (нужна нормализация)
    const filePathFlags = new Set(['-p', '--module-path'])
    let nextIsFilePath = false

    for (const arg of rawArgs) {
      // Пропускаем объекты с правилами (rule-based) — их обрабатывает MCLC
      if (typeof arg !== 'string') continue

      // Пропускаем аргументы которые MCLC уже добавляет сам
      if (arg.startsWith('-Djava.library.path') ||
          arg.startsWith('-Dminecraft.launcher') ||
          arg === '-cp' || arg === '${classpath}') continue

      const isFilePath = nextIsFilePath
      nextIsFilePath = filePathFlags.has(arg)

      // Резолвим переменные Forge
      let r = arg
        .replace(/\$\{library_directory\}/g, libraryDir)
        .replace(/\$\{path_separator\}/g, path.delimiter)
        .replace(/\$\{classpath_separator\}/g, path.delimiter)
        .replace(/\$\{version_name\}/g, loaderVersionId)

      // Нормализуем разделители ТОЛЬКО для аргументов с файловыми путями
      // (не трогаем --add-opens, --add-exports — там java.base/pkg это нотация Java)
      if (isFilePath) {
        r = r.split(path.delimiter).map(p => p.replace(/\//g, path.sep)).join(path.delimiter)
      }

      resolved.push(r)
    }

    Logger.session(`[Launcher] JVM args из Forge JSON: ${resolved.length} аргументов`)
    return resolved
  }

  /** Запасной набор если версионный JSON недоступен */
  _fallbackForgeJvmArgs() {
    return [
      '--add-opens', 'java.base/java.lang.invoke=ALL-UNNAMED',
      '--add-opens', 'java.base/java.lang=ALL-UNNAMED',
      '--add-opens', 'java.base/java.io=ALL-UNNAMED',
      '--add-opens', 'java.base/java.net=ALL-UNNAMED',
      '--add-opens', 'java.base/java.nio=ALL-UNNAMED',
      '--add-opens', 'java.base/sun.net=ALL-UNNAMED',
      '--add-opens', 'java.base/sun.security.util=ALL-UNNAMED',
      '--add-opens', 'java.base/sun.nio.ch=ALL-UNNAMED',
    ]
  }
}

module.exports = new GameLauncher()
