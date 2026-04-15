/**
 * auth.js — авторизация через Microsoft для доступа к лицензионным серверам.
 *
 * Поток:
 *  1. Открываем Electron BrowserWindow с Microsoft OAuth URL (login.live.com)
 *  2. Пользователь логинится
 *  3. Microsoft редиректит на login.live.com/oauth20_desktop.srf — перехватываем code
 *  4. Меняем code → MS access_token (login.live.com/oauth20_token.srf)
 *  5. MS access_token → Xbox Live token
 *  6. Xbox Live token → XSTS token
 *  7. XSTS → Minecraft token
 *  8. Minecraft token → профиль (UUID + ник)
 *  9. Сохраняем всё в настройках
 */

const { BrowserWindow } = require('electron')
const axios = require('axios')
const Settings = require('./settings')

// Официальный client_id Minecraft launcher (desktop app, не требует client_secret)
const CLIENT_ID    = '00000000402b5328'
const REDIRECT_URI = 'https://login.live.com/oauth20_desktop.srf'

// Windows Live / Xbox endpoints
const MS_AUTH_URL  = 'https://login.live.com/oauth20_authorize.srf'
const MS_TOKEN_URL = 'https://login.live.com/oauth20_token.srf'
const XBOX_URL     = 'https://user.auth.xboxlive.com/user/authenticate'
const XSTS_URL     = 'https://xsts.auth.xboxlive.com/xsts/authorize'
const MC_AUTH_URL  = 'https://api.minecraftservices.com/authentication/login_with_xbox'
const MC_PROFILE   = 'https://api.minecraftservices.com/minecraft/profile'

class Auth {

  // ── Полный поток Microsoft авторизации ────────────────────────────────────
  async loginWithMicrosoft(onStatus) {
    onStatus('Открываем окно авторизации Microsoft...')
    const authCode = await this._getMicrosoftAuthCode()

    onStatus('Получаем токен Microsoft...')
    const msTokens = await this._getMicrosoftToken(authCode)

    onStatus('Авторизуемся в Xbox Live...')
    const xblToken = await this._getXboxToken(msTokens.access_token)

    onStatus('Получаем XSTS токен...')
    const xstsData = await this._getXSTSToken(xblToken.Token)

    onStatus('Авторизуемся в Minecraft...')
    const mcToken = await this._getMinecraftToken(
      xstsData.Token,
      xstsData.DisplayClaims.xui[0].uhs
    )

    onStatus('Получаем профиль игрока...')
    const profile = await this._getMinecraftProfile(mcToken.access_token)

    // Сохраняем
    Settings.set('authType',        'microsoft')
    Settings.set('username',        profile.name)
    Settings.set('uuid',            profile.id)
    Settings.set('mcToken',         mcToken.access_token)
    Settings.set('mcTokenExpires',  Date.now() + mcToken.expires_in * 1000)
    Settings.set('msRefreshToken',  msTokens.refresh_token)

    onStatus(`✅ Авторизован как ${profile.name}`)
    return {
      authType: 'microsoft',
      name:     profile.name,
      uuid:     profile.id,
      mcToken:  mcToken.access_token
    }
  }

  // ── Обновить токен если истёк ─────────────────────────────────────────────
  async refreshIfNeeded() {
    const expiry       = Settings.get('mcTokenExpires') || 0
    const refreshToken = Settings.get('msRefreshToken')

    if (!refreshToken) return null

    // Токен ещё свеж (с запасом 1 минута)
    if (Date.now() < expiry - 60_000) {
      return {
        access_token: Settings.get('mcToken'),
        username:     Settings.get('username'),
        uuid:         Settings.get('uuid')
      }
    }

    console.log('[Auth] Обновляем истёкший токен...')
    try {
      const res = await axios.post(MS_TOKEN_URL,
        new URLSearchParams({
          client_id:     CLIENT_ID,
          refresh_token: refreshToken,
          grant_type:    'refresh_token',
          redirect_uri:  REDIRECT_URI
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 }
      )

      const xbl  = await this._getXboxToken(res.data.access_token)
      const xsts = await this._getXSTSToken(xbl.Token)
      const mc   = await this._getMinecraftToken(xsts.Token, xsts.DisplayClaims.xui[0].uhs)

      Settings.set('mcToken',        mc.access_token)
      Settings.set('mcTokenExpires', Date.now() + mc.expires_in * 1000)
      Settings.set('msRefreshToken', res.data.refresh_token || refreshToken)

      return {
        access_token: mc.access_token,
        username:     Settings.get('username'),
        uuid:         Settings.get('uuid')
      }
    } catch (err) {
      console.error('[Auth] Refresh failed:', err.message)
      return null
    }
  }

  // ── Выйти из аккаунта ─────────────────────────────────────────────────────
  logout() {
    Settings.set('authType',       'offline')
    Settings.set('uuid',           null)
    Settings.set('mcToken',        null)
    Settings.set('mcTokenExpires', null)
    Settings.set('msRefreshToken', null)
  }

  // ── Получить auth code через Electron BrowserWindow ───────────────────────
  // Используем login.live.com + REDIRECT_URI = oauth20_desktop.srf
  // Перехватываем редирект через will-redirect / will-navigate событие
  async _getMicrosoftAuthCode() {
    return new Promise((resolve, reject) => {
      const params = new URLSearchParams({
        client_id:     CLIENT_ID,
        response_type: 'code',
        redirect_uri:  REDIRECT_URI,
        scope:         'XboxLive.signin offline_access',
        prompt:        'select_account'
      })

      const authUrl = `${MS_AUTH_URL}?${params.toString()}`

      const win = new BrowserWindow({
        width:           500,
        height:          650,
        title:           'Войти через Microsoft',
        autoHideMenuBar: true,
        webPreferences:  { nodeIntegration: false, contextIsolation: true }
      })

      let resolved = false

      const handleUrl = (navUrl) => {
        if (!navUrl.startsWith(REDIRECT_URI)) return
        const parsed = new URL(navUrl)
        const code   = parsed.searchParams.get('code')
        const error  = parsed.searchParams.get('error')

        if (!resolved) {
          resolved = true
          win.destroy()
          if (code)  resolve(code)
          else       reject(new Error(error || 'Авторизация отменена'))
        }
      }

      // Перехватываем редиректы
      win.webContents.on('will-redirect', (_e, navUrl) => handleUrl(navUrl))
      win.webContents.on('will-navigate',  (_e, navUrl) => handleUrl(navUrl))
      win.webContents.on('did-navigate',   (_e, navUrl) => handleUrl(navUrl))

      win.on('closed', () => {
        if (!resolved) {
          resolved = true
          reject(new Error('Окно авторизации закрыто'))
        }
      })

      win.loadURL(authUrl)
    })
  }

  // ── Обменять code на MS access_token ─────────────────────────────────────
  async _getMicrosoftToken(code) {
    const res = await axios.post(MS_TOKEN_URL,
      new URLSearchParams({
        client_id:    CLIENT_ID,
        code,
        grant_type:   'authorization_code',
        redirect_uri: REDIRECT_URI
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 }
    )
    return res.data
  }

  // ── Xbox Live токен ───────────────────────────────────────────────────────
  async _getXboxToken(msAccessToken) {
    const res = await axios.post(XBOX_URL, {
      Properties: {
        AuthMethod: 'RPS',
        SiteName:   'user.auth.xboxlive.com',
        RpsTicket:  `d=${msAccessToken}`
      },
      RelyingParty: 'http://auth.xboxlive.com',
      TokenType:    'JWT'
    }, {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      timeout: 15000
    })
    return res.data
  }

  // ── XSTS токен ────────────────────────────────────────────────────────────
  async _getXSTSToken(xblToken) {
    const res = await axios.post(XSTS_URL, {
      Properties:   { SandboxId: 'RETAIL', UserTokens: [xblToken] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType:    'JWT'
    }, {
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      timeout: 15000
    })
    return res.data
  }

  // ── Minecraft токен ───────────────────────────────────────────────────────
  async _getMinecraftToken(xstsToken, uhs) {
    const res = await axios.post(MC_AUTH_URL,
      { identityToken: `XBL3.0 x=${uhs};${xstsToken}` },
      { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
    )
    return res.data
  }

  // ── Профиль игрока ────────────────────────────────────────────────────────
  async _getMinecraftProfile(mcToken) {
    const res = await axios.get(MC_PROFILE, {
      headers: { Authorization: `Bearer ${mcToken}` },
      timeout: 15000
    })
    return res.data
  }
}

module.exports = new Auth()
