/**
 * renderer.js — логика UI лаунчера.
 * Все вызовы к системе идут через window.api (preload.js → IPC → main.js).
 */

// ─── State ────────────────────────────────────────────────────────────────────
let state = {
  modpacks: [],        // все сборки из манифеста
  installed: {},       // { modpackId: { version, installedAt } }
  settings: {},
  currentPage: 'home',
  searchQuery: '',
  launching: null,     // id запущенной сборки
  downloading: null,   // id скачиваемой сборки
}

// ─── Init ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  setupWindowControls()
  setupNavigation()
  setupSearch()
  setupRefresh()
  setupUserMenu()

  await loadSettings()
  await loadSystemInfo()
  await loadAppVersion()

  // Показываем индикатор загрузки при первом запросе манифеста
  const connEl = document.getElementById('sb-connection')
  if (connEl) { connEl.textContent = '⬤ Загрузка...'; connEl.style.color = 'var(--text-muted, #888)' }
  await loadManifest()

  setupDownloadListener()
  setupGameStatusListener()
  setupAuthStatusListener()
  setupEditModal()
  initPublishPage()
  setupPublishFormListeners()

  // Загружаем новости, аккаунты и проверяем обновления в фоне
  loadNews()
  loadAccountsList()
  checkLauncherUpdate()
})

// ─── Window Controls ──────────────────────────────────────────────────────────
function setupWindowControls() {
  document.getElementById('btn-minimize').onclick = () => window.api.window.minimize()
  document.getElementById('btn-maximize').onclick = () => window.api.window.maximize()
  document.getElementById('btn-close').onclick    = () => window.api.window.close()
}

// ─── User Menu & Auth ─────────────────────────────────────────────────────────
function setupUserMenu() {
  const btn   = document.getElementById('btn-user-menu')
  const popup = document.getElementById('user-popup')

  // Toggle popup
  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    const open = popup.style.display === 'block'
    popup.style.display = open ? 'none' : 'block'
  })

  // Close on outside click
  document.addEventListener('click', () => {
    popup.style.display = 'none'
  })

  // Microsoft login
  document.getElementById('popup-ms-login').addEventListener('click', async () => {
    popup.style.display = 'none'
    showAuthOverlay('Открываем окно Microsoft...')

    const result = await window.api.auth.loginMicrosoft()

    hideAuthOverlay()

    if (result.success) {
      const d = result.data
      state.settings.authType = 'microsoft'
      state.settings.username = d.name
      state.settings.uuid     = d.uuid
      updateUserDisplay(d.name, true)
      showToast(`✓ Вошли как ${d.name}`, 'success')
      // Сохраняем в список аккаунтов
      await saveCurrentAccountToList()
    } else {
      showToast('Ошибка входа: ' + result.error, 'error')
    }
  })

  // Offline mode
  document.getElementById('popup-offline').addEventListener('click', async () => {
    popup.style.display = 'none'
    await window.api.settings.set('authType', 'offline')
    state.settings.authType = 'offline'
    const name = state.settings.username || 'Player'
    updateUserDisplay(name, false)
    showToast('Переключено в офлайн режим', '')
  })

  // Logout
  document.getElementById('popup-logout').addEventListener('click', async () => {
    popup.style.display = 'none'
    await window.api.auth.logout()
    state.settings.authType = 'offline'
    const name = state.settings.username || 'Player'
    updateUserDisplay(name, false)
    showToast('Выполнен выход из аккаунта', '')
  })
}

function setupAuthStatusListener() {
  window.api.on.authStatus((data) => {
    const el = document.getElementById('auth-overlay-status')
    if (el && data.message) el.textContent = data.message
  })
}

function updateUserDisplay(name, isMicrosoft) {
  document.getElementById('user-name').textContent   = name || 'Player'
  document.getElementById('user-avatar').textContent = (name || 'P')[0].toUpperCase()

  const statusEl = document.getElementById('user-status')
  if (isMicrosoft) {
    statusEl.textContent = '● Microsoft'
    statusEl.style.color = '#22c55e'
  } else {
    statusEl.textContent = '● Офлайн'
    statusEl.style.color = ''
  }
}

function showAuthOverlay(message) {
  const overlay = document.getElementById('auth-overlay')
  const statusEl = document.getElementById('auth-overlay-status')
  if (overlay)  overlay.style.display = 'flex'
  if (statusEl) statusEl.textContent = message || 'Авторизация...'
}

function hideAuthOverlay() {
  const overlay = document.getElementById('auth-overlay')
  if (overlay) overlay.style.display = 'none'
}

// ─── App Version ──────────────────────────────────────────────────────────────
async function loadAppVersion() {
  try {
    const version = await window.api.app.version()
    const el = document.getElementById('app-version-label')
    if (el) el.textContent = `v${version}`
  } catch {}
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function setupNavigation() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      const page = item.dataset.page
      if (!page) return
      navigateTo(page)
    })
  })
}

function navigateTo(page) {
  state.currentPage = page

  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'))
  const navItem = document.querySelector(`.nav-item[data-page="${page}"]`)
  if (navItem) navItem.classList.add('active')

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
  const pageEl = document.getElementById(`page-${page}`)
  if (pageEl) pageEl.classList.add('active')

  const titles = { home: 'Обзор', installed: 'Мои сборки', catalog: 'Каталог', publish: 'Публикация сборки', settings: 'Настройки' }
  document.getElementById('page-title').textContent = titles[page] || page

  // При переходе в страницы рендерим их
  if (page === 'settings')  fillSettingsForm()
  if (page === 'installed') renderInstalledPage()
  if (page === 'catalog')   renderCatalogPage()
}

// ─── Search ───────────────────────────────────────────────────────────────────
function setupSearch() {
  const input = document.getElementById('search-input')
  input.addEventListener('input', () => {
    state.searchQuery = input.value.toLowerCase()
    renderModpacks()
  })
}

// ─── Refresh ──────────────────────────────────────────────────────────────────
function setupRefresh() {
  const btn = document.getElementById('btn-refresh')
  btn.addEventListener('click', async () => {
    btn.classList.add('spinning')
    await loadManifest(true)   // forceRefresh — сбросить кэш
    btn.classList.remove('spinning')
    showToast('✓ Обновлено', 'success')
  })
}

// ─── Load Manifest ────────────────────────────────────────────────────────────
async function loadManifest(forceRefresh = false) {
  try {
    const [manifestResult, installed] = await Promise.all([
      window.api.manifest.fetch(forceRefresh),
      window.api.manifest.getInstalled()
    ])

    state.installed = installed || {}

    if (!manifestResult.success) {
      const errMsg = manifestResult.error || 'Неизвестная ошибка'
      showToast('Не удалось загрузить манифест: ' + errMsg, 'error')
      // Показываем offline-статус в строке состояния
      const connEl = document.getElementById('sb-connection')
      if (connEl) { connEl.textContent = '⬤ Нет соединения'; connEl.style.color = 'var(--red, #f87171)' }
      // Если ошибка связана с отсутствием URL — подсказываем пользователю
      if (errMsg.toLowerCase().includes('url') || errMsg.toLowerCase().includes('настро')) {
        setTimeout(() => showToast('Укажите URL манифеста в Настройках', 'error'), 4000)
      }
      return
    }

    const manifest = manifestResult.data
    state.modpacks = manifest.modpacks || []

    // Показываем уведомление о демо-режиме
    const notice = document.getElementById('demo-notice')
    if (manifest.isDemo) {
      notice.style.display = 'flex'
    } else {
      notice.style.display = 'none'
      const now = new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
      document.getElementById('sb-sync').textContent = `Синхронизировано: ${now}`
      document.getElementById('sb-connection').textContent = '⬤ Подключено'
      document.getElementById('sb-connection').style.color = 'var(--green)'
      // Не перезаписываем Microsoft-статус аккаунта — только офлайн меняем на «В сети»
      if (state.settings.authType !== 'microsoft') {
        document.getElementById('user-status').textContent = '● В сети'
        document.getElementById('user-status').classList.add('online')
      }
    }

    renderModpacks()
    updateBadge()
    checkForUpdates()

  } catch (err) {
    showToast('Ошибка загрузки: ' + err.message, 'error')
    console.error(err)
  }
}

// ─── Render Modpacks ──────────────────────────────────────────────────────────
function renderModpacks() {
  // Если открыта отдельная страница — перерисуем и её
  if (state.currentPage === 'installed') renderInstalledPage()
  if (state.currentPage === 'catalog')   renderCatalogPage()
  const query = state.searchQuery
  const filtered = query
    ? state.modpacks.filter(mp =>
        mp.name.toLowerCase().includes(query) ||
        mp.description?.toLowerCase().includes(query)
      )
    : state.modpacks

  const installedPacks = filtered.filter(mp => state.installed[mp.id])
  const availablePacks = filtered.filter(mp => !state.installed[mp.id])

  // Featured
  const featured = state.modpacks.find(mp => mp.featured)
  renderFeatured(featured)

  // Installed grid
  const installedGrid = document.getElementById('installed-grid')
  const installedCount = document.getElementById('installed-count-label')

  if (installedPacks.length === 0) {
    installedGrid.innerHTML = '<div class="empty-state">Нет установленных сборок</div>'
    installedCount.textContent = ''
  } else {
    installedCount.textContent = `${installedPacks.length} установлено`
    installedGrid.innerHTML = installedPacks.map(mp => renderCard(mp, true)).join('')
  }

  // Available grid
  const availableGrid = document.getElementById('available-grid')
  if (availablePacks.length === 0) {
    availableGrid.innerHTML = '<div class="empty-state">Все сборки уже установлены</div>'
  } else {
    availableGrid.innerHTML = availablePacks.map(mp => renderCard(mp, false)).join('')
  }

  // Attach click handlers
  document.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const action = btn.dataset.action
      const id = btn.dataset.id
      const mp = state.modpacks.find(m => m.id === id)
      if (!mp) return
      if (action === 'play')    handlePlay(mp)
      if (action === 'install') handleInstall(mp)
      if (action === 'update')  handleUpdate(mp)
      if (action === 'edit')    openEditModal(mp)
    })
  })
}

function renderFeatured(mp) {
  const banner = document.getElementById('featured-banner')
  if (!mp) { banner.style.display = 'none'; return; }
  banner.style.display = 'flex'

  document.getElementById('feat-title').textContent = mp.name
  document.getElementById('feat-desc').textContent  = mp.description || ''
  document.getElementById('feat-mc').textContent    = mp.mcVersion || '—'
  document.getElementById('feat-loader').textContent = mp.loader
    ? `${capitalize(mp.loader)} ${mp.loaderVersion || ''}`
    : 'Ванилла'
  document.getElementById('feat-mods').textContent  = mp.totalMods ?? mp.mods?.length ?? '—'
  document.getElementById('feat-size').textContent  = mp.sizeMb ? formatSize(mp.sizeMb) : '—'
  document.getElementById('feat-icon').textContent  = mp.icon || '📦'

  const playBtn = document.getElementById('feat-play-btn')
  const isInstalled = !!state.installed[mp.id]

  if (isInstalled) {
    playBtn.textContent = '▶ Играть'
    playBtn.disabled = !!state.launching
    playBtn.onclick = () => handlePlay(mp)
  } else {
    playBtn.textContent = '⬇ Установить'
    playBtn.disabled = !!state.downloading
    playBtn.onclick = () => handleInstall(mp)
  }
}

function renderCard(mp, isInstalled) {
  const inst = state.installed[mp.id]
  const hasUpdate = inst && mp.version !== inst.version
  const bannerClass = `banner-${mp.bannerColor || 'purple'}`
  const isDownloading = state.downloading === mp.id
  const isLaunching   = state.launching === mp.id

  let statusBadge = ''
  if (hasUpdate) statusBadge = '<div class="card-status status-update">↑ Обновление</div>'
  else if (isInstalled) statusBadge = '<div class="card-status status-installed">✓ Установлен</div>'
  else statusBadge = '<div class="card-status status-new">✨ Доступна</div>'

  let progressHtml = ''
  if (isDownloading) {
    progressHtml = `
      <div class="card-progress">
        <div class="card-progress-label">
          <span id="prog-label-${mp.id}">Подготовка...</span>
          <span id="prog-pct-${mp.id}">0%</span>
        </div>
        <div class="progress-wrap">
          <div class="progress-fill" id="prog-bar-${mp.id}" style="width: 0%"></div>
        </div>
      </div>`
  }

  let actionBtn = ''
  if (isLaunching) {
    actionBtn = `<button class="btn-card btn-card-play" disabled>⏳ Запуск...</button>`
  } else if (isDownloading) {
    actionBtn = `<button class="btn-card btn-card-update" disabled>⬇ Загрузка...</button>`
  } else if (hasUpdate) {
    actionBtn = `<button class="btn-card btn-card-update" data-action="update" data-id="${mp.id}">↑ Обновить</button>`
  } else if (isInstalled) {
    actionBtn = `<button class="btn-card btn-card-play" data-action="play" data-id="${mp.id}">▶ Играть</button>`
  } else {
    actionBtn = `<button class="btn-card btn-card-install" data-action="install" data-id="${mp.id}">⬇ Установить</button>`
  }

  // Шестерёнка — только для установленных
  const gearBtn = isInstalled
    ? `<button class="btn-card-gear" data-action="edit" data-id="${mp.id}" title="Редактировать сборку">⚙</button>`
    : ''

  const modsCount = mp.totalMods ?? mp.mods?.length ?? '?'
  const size = mp.sizeMb ? formatSize(mp.sizeMb) : '?'

  return `
    <div class="modpack-card">
      <div class="card-banner ${bannerClass}">
        ${mp.icon || '📦'}
        <div class="card-banner-overlay"></div>
        ${statusBadge}
      </div>
      <div class="card-body">
        <div class="card-title">${escapeHtml(mp.name)}</div>
        <div class="card-desc">${escapeHtml(mp.description || '')}</div>
        ${progressHtml}
        <div class="card-footer">
          <div class="card-metas">
            <div class="card-meta">⚡ ${modsCount}</div>
            <div class="card-meta">📁 ${size}</div>
          </div>
          <div class="card-actions">
            ${gearBtn}
            ${actionBtn}
          </div>
        </div>
      </div>
    </div>`
}

// ─── Actions ──────────────────────────────────────────────────────────────────
async function handlePlay(mp) {
  if (state.launching) return
  state.launching = mp.id
  renderModpacks()

  // Оверлей нужен — если Forge не установлен, будет автоустановка (3-10 мин)
  showDownloadOverlay(`Запуск: ${mp.name}`)
  updateDownloadOverlay({ message: 'Проверяем загрузчик...', percent: 0 })

  const result = await window.api.game.launch(mp.id)

  hideDownloadOverlay()

  if (!result.success) {
    state.launching = null
    renderModpacks()
    const firstLine = (result.error || 'Неизвестная ошибка').split('\n')[0]
    showToast('Ошибка: ' + firstLine, 'error')
    console.error('[Launch Error]\n' + result.error)
  }
  // Иначе ждём событие game:status 'closed'
}

async function handleInstall(mp) {
  if (state.downloading) return
  state.downloading = mp.id
  showDownloadOverlay(`Установка: ${mp.name}`)
  renderModpacks()

  const result = await window.api.modpack.install(mp)

  hideDownloadOverlay()
  state.downloading = null

  if (result.success) {
    // Обновляем installed
    await refreshInstalled()
    showToast(`✓ ${mp.name} установлен!`, 'success')
  } else {
    showToast('Ошибка установки: ' + result.error, 'error')
  }

  renderModpacks()
}

async function handleUpdate(mp) {
  if (state.downloading) return
  state.downloading = mp.id
  showDownloadOverlay(`Обновление: ${mp.name}`)
  renderModpacks()

  const result = await window.api.modpack.update(mp)

  hideDownloadOverlay()
  state.downloading = null

  if (result.success) {
    await refreshInstalled()
    showToast(`✓ ${mp.name} обновлён!`, 'success')
  } else {
    showToast('Ошибка обновления: ' + result.error, 'error')
  }

  renderModpacks()
}

async function refreshInstalled() {
  state.installed = await window.api.manifest.getInstalled() || {}
  updateBadge()
}

// ─── Installed Page ───────────────────────────────────────────────────────────
let _instSort = 'name'

function renderInstalledPage() {
  const grid = document.getElementById('inst-grid')
  const countLabel = document.getElementById('inst-count-label')
  if (!grid) return

  // Сортировочные кнопки
  document.querySelectorAll('.inst-sort-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.inst-sort-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      _instSort = btn.dataset.sort
      renderInstalledPage()
    }
  })

  const query = state.searchQuery
  let installedPacks = state.modpacks.filter(mp => state.installed[mp.id])
  if (query) {
    installedPacks = installedPacks.filter(mp =>
      mp.name.toLowerCase().includes(query) ||
      mp.description?.toLowerCase().includes(query)
    )
  }

  if (installedPacks.length === 0) {
    grid.innerHTML = query
      ? '<div class="empty-state">Ничего не найдено по запросу</div>'
      : '<div class="empty-state">Нет установленных сборок.<br>Перейди в Каталог чтобы установить.</div>'
    if (countLabel) countLabel.textContent = ''
    return
  }

  // Сортировка
  const sorted = [...installedPacks].sort((a, b) => {
    const ia = state.installed[a.id] || {}
    const ib = state.installed[b.id] || {}
    if (_instSort === 'date') return new Date(ib.installedAt || 0) - new Date(ia.installedAt || 0)
    if (_instSort === 'played') return (ib.totalPlayMinutes || 0) - (ia.totalPlayMinutes || 0)
    return a.name.localeCompare(b.name, 'ru')
  })

  if (countLabel) countLabel.textContent = `${sorted.length} сборок`

  grid.innerHTML = sorted.map(mp => renderInstalledCard(mp)).join('')

  // Вешаем обработчики
  grid.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const action = btn.dataset.action
      const id = btn.dataset.id
      const mp = state.modpacks.find(m => m.id === id)
      if (action === 'play')      handlePlay(mp)
      if (action === 'update')    handleUpdate(mp)
      if (action === 'list-mods') openModsModal(mp)
      if (action === 'open-dir')  openModpackFolder(id)
      if (action === 'uninstall') confirmUninstall(mp)
    })
  })
}

function renderInstalledCard(mp) {
  const inst = state.installed[mp.id] || {}
  const hasUpdate = mp.version !== inst.version
  const isDownloading = state.downloading === mp.id
  const isLaunching   = state.launching === mp.id
  const modsCount = mp.totalMods ?? mp.mods?.length ?? '?'
  const size = mp.sizeMb ? formatSize(mp.sizeMb) : '?'

  // Время игры
  const mins = inst.totalPlayMinutes || 0
  const playTime = mins >= 60
    ? `${Math.floor(mins / 60)}ч ${mins % 60}м`
    : mins > 0 ? `${mins}м` : 'Не играли'
  const lastPlayed = inst.lastPlayed
    ? new Date(inst.lastPlayed).toLocaleDateString('ru', { day: 'numeric', month: 'short' })
    : '—'
  const installedAt = inst.installedAt
    ? new Date(inst.installedAt).toLocaleDateString('ru', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—'

  let actionBtn = ''
  if (isLaunching) {
    actionBtn = `<button class="btn-card btn-card-play" disabled>⏳ Запуск...</button>`
  } else if (isDownloading) {
    actionBtn = `<button class="btn-card btn-card-update" disabled>⬇ Загрузка...</button>`
  } else if (hasUpdate) {
    actionBtn = `<button class="btn-card btn-card-update" data-action="update" data-id="${mp.id}">↑ Обновить</button>`
  } else {
    actionBtn = `<button class="btn-card btn-card-play" data-action="play" data-id="${mp.id}">▶ Играть</button>`
  }

  return `
    <div class="inst-card">
      <div class="inst-card-icon banner-${mp.bannerColor || 'purple'}">${mp.icon || '📦'}</div>
      <div class="inst-card-body">
        <div class="inst-card-title">
          ${escapeHtml(mp.name)}
          ${hasUpdate ? '<span class="inst-update-badge">↑ Обновление</span>' : ''}
        </div>
        <div class="inst-card-meta">
          <span>⚡ MC ${mp.mcVersion || '?'}</span>
          <span>🔧 ${capitalize(mp.loader || 'vanilla')} ${mp.loaderVersion || ''}</span>
          <span>📦 ${modsCount} модов</span>
          <span>💾 ${size}</span>
        </div>
        <div class="inst-card-stats">
          <div class="inst-stat"><span class="inst-stat-label">🎮 Время игры</span><span class="inst-stat-value">${playTime}</span></div>
          <div class="inst-stat"><span class="inst-stat-label">📅 Последний раз</span><span class="inst-stat-value">${lastPlayed}</span></div>
          <div class="inst-stat"><span class="inst-stat-label">🗓 Установлена</span><span class="inst-stat-value">${installedAt}</span></div>
        </div>
        <div class="inst-card-actions">
          ${actionBtn}
          <button class="btn-card-icon" data-action="list-mods" data-id="${mp.id}" title="Список модов">📋</button>
          <button class="btn-card-icon" data-action="open-dir" data-id="${mp.id}" title="Открыть папку">📁</button>
          <button class="btn-card-icon btn-danger" data-action="uninstall" data-id="${mp.id}" title="Удалить сборку">🗑</button>
        </div>
      </div>
    </div>`
}

async function openModpackFolder(modpackId) {
  const settings = state.settings
  const dir = `${settings.gamePath}/modpacks/${modpackId}`.replace(/\//g, '\\')
  await window.api.shell.openPath(dir)
}

async function confirmUninstall(mp) {
  const confirmed = window.confirm(`Удалить сборку "${mp.name}"?\n\nВсе файлы модов будут удалены. Твои миры и настройки останутся.`)
  if (!confirmed) return

  const result = await window.api.modpack.delete(mp.id)
  if (result.success) {
    await refreshInstalled()
    renderModpacks()
    renderInstalledPage()
    showToast(`✓ Сборка "${mp.name}" удалена`, 'success')
  } else {
    showToast('Ошибка удаления: ' + result.error, 'error')
  }
}

// ─── Catalog Page ─────────────────────────────────────────────────────────────
let _catFilter = 'all'

function renderCatalogPage() {
  const grid = document.getElementById('cat-grid')
  const countLabel = document.getElementById('cat-count-label')
  if (!grid) return

  // Фильтр-кнопки
  document.querySelectorAll('.cat-filter-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.cat-filter-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      _catFilter = btn.dataset.filter
      renderCatalogPage()
    }
  })

  const catQuery = state.searchQuery
  let filtered = state.modpacks
  if (_catFilter === 'available') filtered = filtered.filter(mp => !state.installed[mp.id])
  if (_catFilter === 'installed') filtered = filtered.filter(mp => !!state.installed[mp.id])
  if (catQuery) {
    filtered = filtered.filter(mp =>
      mp.name.toLowerCase().includes(catQuery) ||
      mp.description?.toLowerCase().includes(catQuery)
    )
  }

  if (countLabel) countLabel.textContent = `${filtered.length} сборок`

  if (filtered.length === 0) {
    grid.innerHTML = '<div class="empty-state">Нет подходящих сборок</div>'
    return
  }

  grid.innerHTML = filtered.map(mp => renderCard(mp, !!state.installed[mp.id])).join('')

  grid.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const action = btn.dataset.action
      const id = btn.dataset.id
      const mp = state.modpacks.find(m => m.id === id)
      if (!mp) return
      if (action === 'play')    handlePlay(mp)
      if (action === 'install') handleInstall(mp)
      if (action === 'update')  handleUpdate(mp)
      if (action === 'edit')    openEditModal(mp)
    })
  })
}

// ─── Download Overlay ─────────────────────────────────────────────────────────
function setupDownloadListener() {
  window.api.on.downloadProgress((data) => {
    updateDownloadOverlay(data)

    // Обновляем прогресс-бар на карточке
    if (data.modpackId) {
      const bar   = document.getElementById(`prog-bar-${data.modpackId}`)
      const pct   = document.getElementById(`prog-pct-${data.modpackId}`)
      const label = document.getElementById(`prog-label-${data.modpackId}`)
      if (bar)   bar.style.width = `${data.percent || 0}%`
      if (pct)   pct.textContent = `${data.percent || 0}%`
      if (label) label.textContent = data.currentFile || data.message || ''
    }
  })
}

function showDownloadOverlay(title) {
  document.getElementById('dl-title').textContent = title
  document.getElementById('dl-file').textContent = ''
  document.getElementById('dl-bar').style.width = '0%'
  document.getElementById('dl-percent').textContent = '0%'
  document.getElementById('download-overlay').style.display = 'flex'
}

function updateDownloadOverlay(data) {
  document.getElementById('dl-file').textContent = data.currentFile || data.message || ''
  document.getElementById('dl-bar').style.width = `${data.percent || 0}%`
  document.getElementById('dl-percent').textContent = `${data.percent || 0}%`
}

function hideDownloadOverlay() {
  document.getElementById('download-overlay').style.display = 'none'
}

// ─── Game Status ──────────────────────────────────────────────────────────────
function setupGameStatusListener() {
  window.api.on.gameStatus((data) => {
    console.log('[Game status]', data)

    if (data.status === 'launched') {
      // Игра запущена — скрываем оверлей, показываем toast
      hideDownloadOverlay()
      showToast('✓ Игра запущена!', 'success')
      // Закрываем лаунчер если включена опция
      if (state.settings.closeOnLaunch) window.api.window.close()
    }

    if (data.status === 'loading') {
      // Идёт загрузка ассетов — обновляем оверлей
      updateDownloadOverlay({ message: data.message || 'Загрузка...', percent: data.percent || 0 })
    }

    if (data.status === 'closed' || data.status === 'error') {
      hideDownloadOverlay()
      state.launching = null
      // Обновляем installed — время игры могло обновиться в main процессе
      await refreshInstalled()
      renderModpacks()
      if (data.status === 'error' || (data.status === 'closed' && data.code && data.code !== 0)) {
        showToast('Игра завершилась с ошибкой — смотри лог', 'error')
        setTimeout(() => showCrashModal(), 500)
      }
    }
  })
}

// ─── Publish Page ─────────────────────────────────────────────────────────────
let publishState = {
  archivePath: null,
  publishing: false
}

function initPublishPage() {
  // Проверка токена
  document.getElementById('btn-check-token').onclick = checkToken

  // Выбор архива
  document.getElementById('btn-browse-archive').onclick = browseArchive

  // Drag & Drop
  const dropZone = document.getElementById('drop-zone')
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover') })
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'))
  dropZone.addEventListener('drop', async (e) => {
    e.preventDefault()
    dropZone.classList.remove('dragover')
    const file = e.dataTransfer.files[0]
    if (file) await loadArchive(file.path)
  })

  // Кнопка публикации
  document.getElementById('btn-publish').onclick = startPublish

  // Слушаем события от main процесса
  window.api.on.editorStatus((data) => {
    // Логируем только важные события, не каждый процент
    if (!data.silent) {
      const type = data.step === 'done' ? 'ok' : data.step === 'error' ? 'error' : 'info'
      appendLog(data.message, type)
    }
    if (data.step === 'done') {
      setPublishing(false)
      showToast('✓ Сборка опубликована!', 'success')
      loadManifest()
    }
    if (data.step === 'error') {
      setPublishing(false)
    }
  })

  window.api.on.editorProgress((data) => {
    const pct = data.overall || data.filePct || 0
    const label = data.filename ? `Загружаем: ${data.filename} — ${pct}%` : `${pct}%`
    // silent = только прогресс-бар, без записи в лог
    if (!data.silent) {
      appendLog(label, 'info')
    }
    updatePublishProgress(pct, label)
  })

  // Заполняем сохранённый токен
  const savedToken = state.settings.githubToken || ''
  if (savedToken) {
    document.getElementById('pub-token').value = savedToken
  }
}

async function checkToken() {
  const token = document.getElementById('pub-token').value.trim()
  if (!token) { showToast('Введите токен', 'error'); return }

  await window.api.settings.set('githubToken', token)
  state.settings.githubToken = token

  const btn = document.getElementById('btn-check-token')
  btn.textContent = '...'
  btn.disabled = true

  const result = await window.api.editor.validateToken()

  btn.textContent = 'Проверить'
  btn.disabled = false

  const statusEl = document.getElementById('token-status')
  if (result.ok) {
    statusEl.textContent = `✓ ${result.login}`
    statusEl.className = 'token-status ok'
    showToast(`✓ Токен действителен (${result.login})`, 'success')
  } else {
    statusEl.textContent = `✗ Ошибка`
    statusEl.className = 'token-status error'
    showToast('Неверный токен: ' + result.error, 'error')
  }
}

async function browseArchive() {
  const filePath = await window.api.editor.browseArchive()
  if (filePath) await loadArchive(filePath)
}

async function loadArchive(filePath) {
  publishState.archivePath = filePath
  const filename = filePath.split(/[\\/]/).pop()

  const dropZone = document.getElementById('drop-zone')
  document.getElementById('drop-filename').textContent = filename
  document.getElementById('drop-icon') && (document.querySelector('.drop-icon').textContent = '⏳')
  dropZone.classList.add('has-file')

  appendLog(`Сканируем архив: ${filename}`, 'info')

  const result = await window.api.editor.preview(filePath)

  if (!result.success) {
    showToast('Ошибка чтения архива: ' + result.error, 'error')
    appendLog('Ошибка: ' + result.error, 'error')
    return
  }

  document.querySelector('.drop-icon').textContent = '✅'
  appendLog(`Найдено ${result.totalMods} .jar файлов`, 'ok')

  // Показываем предпросмотр
  const preview = document.getElementById('mods-preview')
  const list = document.getElementById('mods-list')
  const countEl = document.getElementById('preview-count')

  preview.style.display = 'block'
  countEl.textContent = `Найдено модов: ${result.totalMods}`

  list.innerHTML = result.mods.map(m => `
    <div class="mod-item">
      <span class="mod-name" title="${m.filename}">⚙ ${m.name}</span>
      <span class="mod-custom">custom</span>
      <span class="mod-size">${m.sizeMb} MB</span>
    </div>`
  ).join('')

  // Включаем кнопку если всё заполнено
  checkPublishReady()
}

function checkPublishReady() {
  const hasArchive = !!publishState.archivePath
  const hasId = !!document.getElementById('pub-id')?.value.trim()
  const hasName = !!document.getElementById('pub-name')?.value.trim()
  const hasVersion = !!document.getElementById('pub-version')?.value.trim()
  const hasMc = !!document.getElementById('pub-mc')?.value.trim()

  const btn = document.getElementById('btn-publish')
  if (btn) btn.disabled = !(hasArchive && hasId && hasName && hasVersion && hasMc) || publishState.publishing
}

// Слушаем изменения в форме
function setupPublishFormListeners() {
  ['pub-id','pub-name','pub-version','pub-mc'].forEach(id => {
    const el = document.getElementById(id)
    if (el) el.addEventListener('input', checkPublishReady)
  })
}

async function startPublish() {
  if (publishState.publishing) return
  if (!publishState.archivePath) { showToast('Выберите архив', 'error'); return }

  const modpackMeta = {
    id:            document.getElementById('pub-id').value.trim(),
    name:          document.getElementById('pub-name').value.trim(),
    version:       document.getElementById('pub-version').value.trim(),
    mcVersion:     document.getElementById('pub-mc').value.trim(),
    loader:        document.getElementById('pub-loader').value,
    loaderVersion: document.getElementById('pub-loader-ver').value.trim(),
    description:   document.getElementById('pub-desc').value.trim(),
    icon:          document.getElementById('pub-icon').value.trim() || '📦',
    bannerColor:   document.getElementById('pub-color').value,
    featured:      document.getElementById('pub-featured').checked
  }

  if (!modpackMeta.id || !modpackMeta.name || !modpackMeta.version) {
    showToast('Заполните ID, название и версию сборки', 'error')
    return
  }

  // Сохраняем токен
  const token = document.getElementById('pub-token').value.trim()
  if (token) await window.api.settings.set('githubToken', token)

  setPublishing(true)
  clearLog()
  appendLog(`Публикуем: ${modpackMeta.name} v${modpackMeta.version}`, 'info')

  const result = await window.api.editor.publish(publishState.archivePath, modpackMeta)

  if (!result.success) {
    setPublishing(false)
    appendLog('Ошибка: ' + result.error, 'error')
    showToast('Ошибка публикации: ' + result.error, 'error')
  }
}

function setPublishing(active) {
  publishState.publishing = active
  const btn = document.getElementById('btn-publish')
  const progress = document.getElementById('pub-progress')
  if (btn) {
    btn.disabled = active
    btn.textContent = active ? '⏳ Публикуем...' : '📤 Опубликовать сборку на GitHub'
  }
  if (progress) progress.style.display = active ? 'block' : 'none'
}

function updatePublishProgress(percent, text) {
  const bar = document.getElementById('pub-progress-bar')
  const pct = document.getElementById('pub-progress-pct')
  const txt = document.getElementById('pub-progress-text')
  if (bar) bar.style.width = `${percent}%`
  if (pct) pct.textContent = `${percent}%`
  if (txt) txt.textContent = text || ''
}

function appendLog(message, type = '') {
  const log = document.getElementById('pub-log')
  if (!log) return

  // Убираем заглушку
  const hint = log.querySelector('.log-hint')
  if (hint) hint.remove()

  const line = document.createElement('div')
  line.className = `log-line ${type}`
  const time = new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  line.textContent = `[${time}] ${message}`
  log.appendChild(line)
  log.scrollTop = log.scrollHeight
}

function clearLog() {
  const log = document.getElementById('pub-log')
  if (log) log.innerHTML = ''
}

// ─── Modpack Edit Modal ───────────────────────────────────────────────────────
let editState = { modpack: null, jars: [], patching: false }

function openEditModal(mp) {
  editState = { modpack: mp, jars: [], patching: false }

  document.getElementById('edit-pack-name').textContent = `${mp.icon || '📦'} ${mp.name} v${mp.version}`
  document.getElementById('edit-jar-list').innerHTML = ''
  document.getElementById('edit-log').style.display = 'none'
  document.getElementById('edit-log').innerHTML = ''
  document.getElementById('edit-progress').style.display = 'none'
  document.getElementById('btn-patch-publish').disabled = true
  document.getElementById('edit-modal').style.display = 'flex'
}

function closeEditModal() {
  document.getElementById('edit-modal').style.display = 'none'
  editState = { modpack: null, jars: [], patching: false }
}

function setupEditModal() {
  document.getElementById('edit-modal-close').onclick  = closeEditModal
  document.getElementById('edit-modal-cancel').onclick = closeEditModal
  document.getElementById('edit-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('edit-modal')) closeEditModal()
  })

  // Выбор .jar файлов
  document.getElementById('btn-browse-jars').onclick = async () => {
    const files = await window.api.editor.browseJars()
    if (files?.length) addJarsToList(files)
  }

  // Drag & drop
  const dropZone = document.getElementById('edit-drop-zone')
  dropZone.addEventListener('dragover', (e) => { e.preventDefault(); dropZone.classList.add('dragover') })
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'))
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault()
    dropZone.classList.remove('dragover')
    const files = [...e.dataTransfer.files]
      .filter(f => f.name.endsWith('.jar'))
      .map(f => f.path)
    if (files.length) addJarsToList(files)
  })

  // Публикация патча
  document.getElementById('btn-patch-publish').onclick = patchModpack

  // Прогресс патча
  window.api.on.editorProgress((data) => {
    if (editState.patching) {
      const pct = data.overall || data.filePct || 0
      document.getElementById('edit-progress').style.display = 'block'
      document.getElementById('edit-progress-bar').style.width = `${pct}%`
      document.getElementById('edit-progress-text').textContent = `${pct}%`
    }
  })

  window.api.on.editorStatus((data) => {
    if (editState.patching && !data.silent) {
      appendEditLog(data.message, data.step === 'error' ? 'error' : data.step === 'done' ? 'ok' : 'info')
      if (data.step === 'done') {
        editState.patching = false
        document.getElementById('btn-patch-publish').disabled = false
        document.getElementById('btn-patch-publish').textContent = '📤 Загрузить на GitHub'
        showToast('✓ Сборка обновлена!', 'success')
        loadManifest(true)
      }
      if (data.step === 'error') {
        editState.patching = false
        document.getElementById('btn-patch-publish').disabled = false
        document.getElementById('btn-patch-publish').textContent = '📤 Загрузить на GitHub'
      }
    }
  })
}

function addJarsToList(filePaths) {
  filePaths.forEach(fp => {
    if (!editState.jars.includes(fp)) editState.jars.push(fp)
  })
  renderJarList()
}

function renderJarList() {
  const list = document.getElementById('edit-jar-list')
  if (editState.jars.length === 0) {
    list.innerHTML = ''
    document.getElementById('btn-patch-publish').disabled = true
    return
  }
  list.innerHTML = editState.jars.map((fp, i) => {
    const name = fp.split(/[\\/]/).pop()
    return `<div class="edit-jar-item">
      <span class="edit-jar-name">⚙ ${escapeHtml(name)}</span>
      <button class="edit-jar-remove" data-idx="${i}">✕</button>
    </div>`
  }).join('')

  list.querySelectorAll('.edit-jar-remove').forEach(btn => {
    btn.onclick = () => {
      editState.jars.splice(parseInt(btn.dataset.idx), 1)
      renderJarList()
    }
  })

  document.getElementById('btn-patch-publish').disabled = editState.patching
}

async function patchModpack() {
  if (!editState.modpack || editState.jars.length === 0) return
  const token = state.settings.githubToken
  if (!token) { showToast('Укажи GitHub Token в настройках публикации', 'error'); return }

  editState.patching = true
  document.getElementById('btn-patch-publish').disabled = true
  document.getElementById('btn-patch-publish').textContent = '⏳ Загружаем...'
  document.getElementById('edit-log').style.display = 'block'
  document.getElementById('edit-log').innerHTML = ''
  appendEditLog(`Добавляем ${editState.jars.length} мод(ов) в ${editState.modpack.name}...`, 'info')

  const result = await window.api.editor.patchModpack(editState.modpack, editState.jars)
  if (!result.success) {
    editState.patching = false
    document.getElementById('btn-patch-publish').disabled = false
    document.getElementById('btn-patch-publish').textContent = '📤 Загрузить на GitHub'
    appendEditLog('Ошибка: ' + result.error, 'error')
    showToast('Ошибка: ' + result.error, 'error')
  }
}

function appendEditLog(msg, type = '') {
  const log = document.getElementById('edit-log')
  const line = document.createElement('div')
  line.className = `log-line ${type}`
  const t = new Date().toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  line.textContent = `[${t}] ${msg}`
  log.appendChild(line)
  log.scrollTop = log.scrollHeight
}

// ─── Settings ─────────────────────────────────────────────────────────────────
async function loadSettings() {
  const s = await window.api.settings.get()
  state.settings = s

  const name = s.username || 'Player'
  const isMicrosoft = s.authType === 'microsoft'
  updateUserDisplay(name, isMicrosoft)
}

function fillSettingsForm() {
  const s = state.settings
  document.getElementById('set-username').value       = s.username || ''
  document.getElementById('set-minecraft-path').value = s.minecraftPath || ''
  document.getElementById('set-game-path').value      = s.gamePath || ''
  document.getElementById('set-min-ram').value      = s.minRam || 1024
  document.getElementById('set-max-ram').value      = s.maxRam || 4096
  document.getElementById('set-java-path').value    = s.javaPath || ''
  document.getElementById('set-width').value        = s.gameWidth || 1280
  document.getElementById('set-height').value       = s.gameHeight || 720
  document.getElementById('set-fullscreen').checked     = !!s.fullscreen
  document.getElementById('set-close-on-launch').checked = !!s.closeOnLaunch
  document.getElementById('set-jvm-args').value        = s.jvmArgs || ''
  document.getElementById('set-launcher-repo').value   = s.launcherRepo || ''
  updateRamLabel(s.maxRam || 4096)

  // Обработчики настроек
  document.getElementById('set-max-ram').oninput = (e) => updateRamLabel(e.target.value)

  document.getElementById('btn-browse-mc-path').onclick = async () => {
    const folder = await window.api.settings.browseFolder()
    if (folder) document.getElementById('set-minecraft-path').value = folder
  }

  document.getElementById('btn-browse-path').onclick = async () => {
    const folder = await window.api.settings.browseFolder()
    if (folder) document.getElementById('set-game-path').value = folder
  }

  document.getElementById('btn-browse-java').onclick = async () => {
    const file = await window.api.settings.browseJava()
    if (file) document.getElementById('set-java-path').value = file
  }

  document.getElementById('btn-save-settings').onclick = saveSettings

  document.getElementById('btn-clear-cache').onclick = async () => {
    const result = await window.api.app.clearInstallerCache()
    if (result.success) {
      const msg = result.count > 0
        ? `✓ Удалено ${result.count} файл(ов) кэша`
        : '✓ Кэш уже пуст'
      showToast(msg, 'success')
    } else {
      showToast('Ошибка: ' + result.error, 'error')
    }
  }
}

async function saveSettings() {
  const newSettings = {
    username:       document.getElementById('set-username').value.trim() || 'Player',
    minecraftPath:  document.getElementById('set-minecraft-path').value.trim(),
    gamePath:       document.getElementById('set-game-path').value.trim(),
    minRam:         parseInt(document.getElementById('set-min-ram').value),
    maxRam:         parseInt(document.getElementById('set-max-ram').value),
    javaPath:       document.getElementById('set-java-path').value.trim(),
    jvmArgs:        document.getElementById('set-jvm-args').value.trim(),
    launcherRepo:   document.getElementById('set-launcher-repo').value.trim(),
    gameWidth:      parseInt(document.getElementById('set-width').value),
    gameHeight:     parseInt(document.getElementById('set-height').value),
    fullscreen:     document.getElementById('set-fullscreen').checked,
    closeOnLaunch:  document.getElementById('set-close-on-launch').checked,
  }

  for (const [key, val] of Object.entries(newSettings)) {
    await window.api.settings.set(key, val)
  }

  state.settings = { ...state.settings, ...newSettings }
  updateUserDisplay(newSettings.username, state.settings.authType === 'microsoft')

  const statusEl = document.getElementById('save-status')
  statusEl.textContent = '✓ Сохранено'
  setTimeout(() => statusEl.textContent = '', 3000)

  showToast('Настройки сохранены', 'success')
}

function updateRamLabel(mb) {
  const gb = (parseInt(mb) / 1024).toFixed(1)
  document.getElementById('ram-gb-label').textContent = `${gb} GB`
}

// ─── System Info ──────────────────────────────────────────────────────────────
async function loadSystemInfo() {
  try {
    const info = await window.api.system.info()
    document.getElementById('sb-java').textContent = `Java: ${info.platform === 'win32' ? 'Windows' : info.platform}`

    const sysEl = document.getElementById('sysinfo')
    sysEl.innerHTML = `
      <div class="sysinfo-item"><div class="sysinfo-label">Платформа</div><div class="sysinfo-value">${info.platform}</div></div>
      <div class="sysinfo-item"><div class="sysinfo-label">Архитектура</div><div class="sysinfo-value">${info.arch}</div></div>
      <div class="sysinfo-item"><div class="sysinfo-label">Всего RAM</div><div class="sysinfo-value">${info.totalRam} GB</div></div>
      <div class="sysinfo-item"><div class="sysinfo-label">Ядра CPU</div><div class="sysinfo-value">${info.cpus}</div></div>
    `
  } catch (e) {
    console.error('Sysinfo error', e)
  }
}

// ─── Badge ────────────────────────────────────────────────────────────────────
function updateBadge() {
  const count = Object.keys(state.installed).length
  const badge = document.getElementById('badge-installed')
  badge.textContent = count
  badge.style.display = count > 0 ? 'inline-block' : 'none'
}

// ─── Toast ────────────────────────────────────────────────────────────────────
let toastTimer = null
function showToast(message, type = '') {
  const el = document.getElementById('toast')
  el.textContent = message
  el.className = 'toast show' + (type ? ` ${type}` : '')
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => { el.classList.remove('show') }, 3500)
}

// ─── Utils ────────────────────────────────────────────────────────────────────
function formatSize(mb) {
  if (mb >= 1024) return (mb / 1024).toFixed(1) + ' GB'
  return mb + ' MB'
}

function capitalize(str) {
  return str ? str[0].toUpperCase() + str.slice(1) : str
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// ─── Update Notification ──────────────────────────────────────────────────────
function checkForUpdates() {
  const updates = state.modpacks.filter(mp => {
    const inst = state.installed[mp.id]
    return inst && mp.version !== inst.version
  })

  const banner = document.getElementById('update-banner')
  if (!banner) return

  if (updates.length > 0) {
    const names = updates.map(mp => mp.name).join(', ')
    document.getElementById('update-banner-text').textContent =
      `🔔 Доступно обновление для: ${names}`
    banner.style.display = 'flex'

    document.getElementById('update-banner-btn').onclick = () => {
      navigateTo('installed')
      banner.style.display = 'none'
    }
  } else {
    banner.style.display = 'none'
  }
}

// ─── News (GitHub Releases) ────────────────────────────────────────────────────
async function loadNews() {
  const section = document.getElementById('news-section')
  const list    = document.getElementById('news-list')
  if (!section || !list) return

  try {
    const result = await window.api.releases.fetch()
    if (!result.success || !result.data?.length) return

    section.style.display = 'block'
    list.innerHTML = result.data.map(r => {
      const date = r.date ? new Date(r.date).toLocaleDateString('ru', { day: 'numeric', month: 'long' }) : ''
      // Берём первые 3 строки из changelog
      const lines = (r.body || '').split('\n').filter(l => l.trim()).slice(0, 4)
      const bodyHtml = lines.map(l => `<div class="news-line">${escapeHtml(l.replace(/^#+\s*/, '').replace(/^\*+\s*/, '• '))}</div>`).join('')
      return `
        <div class="news-item">
          <div class="news-header">
            <span class="news-tag">${escapeHtml(r.tag)}</span>
            <span class="news-title">${escapeHtml(r.name)}</span>
            <span class="news-date">${date}</span>
          </div>
          <div class="news-body">${bodyHtml || '<div class="news-line news-empty">Нет описания</div>'}</div>
        </div>`
    }).join('')
  } catch (e) {
    console.warn('[News] Ошибка загрузки:', e.message)
  }
}

// ─── Multi-Account ────────────────────────────────────────────────────────────
let _accountsList = []

async function loadAccountsList() {
  _accountsList = await window.api.accounts.list() || []
  renderAccountsPopup()
}

function renderAccountsPopup() {
  const section = document.getElementById('popup-accounts-section')
  const list    = document.getElementById('popup-accounts-list')
  if (!section || !list) return

  if (_accountsList.length === 0) {
    section.style.display = 'none'
    return
  }

  section.style.display = 'block'
  list.innerHTML = _accountsList.map(acc => {
    const isActive = acc.name === state.settings.username && acc.authType === state.settings.authType
    return `
      <div class="user-popup-account ${isActive ? 'active' : ''}" data-id="${acc.id}">
        <span class="account-avatar">${(acc.name || '?')[0].toUpperCase()}</span>
        <span class="account-name">${escapeHtml(acc.name)}</span>
        ${isActive ? '<span class="account-check">✓</span>' : '<span class="account-remove" data-id="' + acc.id + '">✕</span>'}
      </div>`
  }).join('')

  // Переключение аккаунта
  list.querySelectorAll('.user-popup-account:not(.active)').forEach(el => {
    el.addEventListener('click', async (e) => {
      if (e.target.classList.contains('account-remove')) return
      const id = el.dataset.id
      document.getElementById('user-popup').style.display = 'none'
      const result = await window.api.accounts.switch(id)
      if (result.success) {
        state.settings = { ...state.settings, ...result.data }
        updateUserDisplay(result.data.name, result.data.authType === 'microsoft')
        showToast(`✓ Переключились на ${result.data.name}`, 'success')
        renderAccountsPopup()
      } else {
        showToast('Ошибка: ' + result.error, 'error')
      }
    })
  })

  // Удаление аккаунта
  list.querySelectorAll('.account-remove').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const id = btn.dataset.id
      await window.api.accounts.remove(id)
      _accountsList = _accountsList.filter(a => a.id !== id)
      renderAccountsPopup()
    })
  })
}

// Сохраняем аккаунт в список после успешного логина
async function saveCurrentAccountToList() {
  await window.api.accounts.saveCurrent()
  _accountsList = await window.api.accounts.list() || []
  renderAccountsPopup()
}

// ─── Mod List Modal ───────────────────────────────────────────────────────────
let _modsModalData = []

async function openModsModal(mp) {
  const modal = document.getElementById('mods-modal')
  const title = document.getElementById('mods-modal-title')
  const list  = document.getElementById('mods-modal-list')
  const count = document.getElementById('mods-count')
  const search = document.getElementById('mods-search')
  if (!modal) return

  title.textContent = `📋 Моды: ${mp.name}`
  list.innerHTML = '<div class="empty-state">Загрузка...</div>'
  count.textContent = ''
  search.value = ''
  modal.style.display = 'flex'

  const result = await window.api.modpack.listMods(mp.id)
  _modsModalData = result.mods || []
  renderModsList(_modsModalData)

  search.oninput = () => {
    const q = search.value.toLowerCase()
    renderModsList(q ? _modsModalData.filter(m => m.name.toLowerCase().includes(q)) : _modsModalData)
  }

  document.getElementById('mods-modal-close').onclick = () => {
    modal.style.display = 'none'
  }
}

function renderModsList(mods) {
  const list  = document.getElementById('mods-modal-list')
  const count = document.getElementById('mods-count')
  count.textContent = `${mods.length} модов`

  if (mods.length === 0) {
    list.innerHTML = '<div class="empty-state">Ничего не найдено</div>'
    return
  }

  list.innerHTML = mods.map(m => {
    const name = m.name.replace(/\.jar$/, '')
    const size = m.size >= 1024 ? (m.size / 1024).toFixed(1) + ' MB' : m.size + ' KB'
    return `<div class="mod-list-item">
      <span class="mod-list-icon">⚙</span>
      <span class="mod-list-name">${escapeHtml(name)}</span>
      <span class="mod-list-size">${size}</span>
    </div>`
  }).join('')
}

// ─── Crash Log Modal ──────────────────────────────────────────────────────────
async function showCrashModal() {
  const modal = document.getElementById('crash-modal')
  const box   = document.getElementById('crash-log-box')
  if (!modal) return

  box.textContent = 'Загрузка лога...'
  modal.style.display = 'flex'

  const result = await window.api.logs.readLatest(60)
  if (result.success) {
    box.textContent = result.data
    box.scrollTop = box.scrollHeight
  } else {
    box.textContent = 'Не удалось прочитать лог: ' + result.error
  }

  document.getElementById('crash-modal-close').onclick = () => {
    modal.style.display = 'none'
  }

  document.getElementById('crash-open-log').onclick = async () => {
    const r = await window.api.logs.readLatest(1)
    if (r.path) await window.api.shell.openPath(r.path.replace(/[^/\\]*$/, ''))
  }
}

// ─── Launcher Auto-Update ─────────────────────────────────────────────────────
async function checkLauncherUpdate() {
  try {
    const result = await window.api.launcher.checkUpdate()
    if (!result.hasUpdate) return

    const banner = document.getElementById('launcher-update-banner')
    const text   = document.getElementById('launcher-update-text')
    if (!banner) return

    text.textContent = `🚀 Доступна новая версия лаунчера: v${result.latestVersion}`
    banner.style.display = 'flex'

    document.getElementById('launcher-update-btn').onclick = () => {
      window.api.shell.openUrl(result.releaseUrl)
      banner.style.display = 'none'
    }
    document.getElementById('launcher-update-dismiss').onclick = () => {
      banner.style.display = 'none'
    }
  } catch {}
}
