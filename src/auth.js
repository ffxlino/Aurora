/**
 * auth.js — авторизация через Microsoft (localhost loopback OAuth).
 *
 * Поток:
 *  1. Запускаем временный HTTP-сервер на случайном порту (127.0.0.1:PORT)
 *  2. Открываем Microsoft OAuth URL в системном браузере пользователя
 *  3. Пользователь логинится в браузере
 *  4. Microsoft редиректит на http://localhost:PORT?code=...
 *  5. Сервер перехватывает code, закрывается, показывает страницу "можно закрыть"
 *  6. code → MS access_token → Xbox Live → XSTS → Minecraft token → профиль
 *  7. Сохраняем всё в настройках
 */

const http    = require('http')
const { shell } = require('electron')
const axios   = require('axios')
const Settings = require('./settings')

const CLIENT_ID   = '00000000402b5328'
const MS_AUTH_URL = 'https://login.live.com/oauth20_authorize.srf'
const MS_TOKEN_URL = 'https://login.live.com/oauth20_token.srf'
const XBOX_URL    = 'https://user.auth.xboxlive.com/user/authenticate'
const XSTS_URL    = 'https://xsts.auth.xboxlive.com/xsts/authorize'
const MC_AUTH_URL = 'https://api.minecraftservices.com/authentication/login_with_xbox'
const MC_PROFILE  = 'https://api.minecraftservices.com/minecraft/profile'

// HTML-страница, которую пользователь видит в браузере после успешного входа
const SUCCESS_HTML = `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"><title>CraftSync — Вход выполнен</title>
<style>
  body { margin: 0; display: flex; align-items: center; justify-content: center;
         min-height: 100vh; background: #0d0b14; font-family: Inter, sans-serif; color: #f1f0f5; }
  .box { text-align: center; padding: 48px; max-width: 420px; }
  .icon { font-size: 64px; margin-bottom: 16px; }
  h1 { font-size: 22px; margin: 0 0 8px; color: #7c3aed; }
  p  { color: #9ca3af; margin: 0; line-height: 1.5; }
</style></head>
<body><div class="box">
  <div class="icon">✅</div>
  <h1>Авторизация успешна!</h1>
  <p>Вы вошли в аккаунт.<br>Эту вкладку можно закрыть — лаунчер уже получил данные.</p>
</div></body></html>`

const ERROR_HTML = (msg) => `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"><title>CraftSync — Ошибка</title>
<style>
  body { margin: 0; display: flex; align-items: center; justify-content: center;
         min-height: 100vh; background: #0d0b14; font-family: Inter, sans-serif; color: #f1f0f5; }
  .box { text-align: center; padding: 48px; max-width: 420px; }
  .icon { font-size: 64px; margin-bottom: 16px; }
  h1 { font-size: 22px; margin: 0 0 8px; color: #ef4444; }
  p  { color: #9ca3af; margin: 0; }
</style></head>
<body><div class="box">
  <div class="icon">❌</div>
  <h1>Ошибка авторизации</h1>
  <p>${msg}</p>
</div></body></html>`

class Auth {

  // ── Полный поток Microsoft авторизации ────────────────────────────────────
  async loginWithMicrosoft(onStatus) {
    onStatus('Открываем браузер для входа...')
    const { code, redirectUri } = await this._getMicrosoftAuthCode(onStatus)

    onStatus('Получаем токен Microsoft...')
    const msTokens = await this._getMicrosoftToken(code, redirectUri)

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

    Settings.set('authType',       'microsoft')
    Settings.set('username',       profile.name)
    Settings.set('uuid',           profile.id)
    Settings.set('mcToken',        mcToken.access_token)
    Settings.set('mcTokenExpires', Date.now() + mcToken.expires_in * 1000)
    Settings.set('msRefreshToken', msTokens.refresh_token)

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
          redirect_uri:  'http://localhost'  // при refresh redirect_uri не важен, но обязателен
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

  logout() {
    Settings.set('authType',       'offline')
    Settings.set('uuid',           null)
    Settings.set('mcToken',        null)
    Settings.set('mcTokenExpires', null)
    Settings.set('msRefreshToken', null)
  }

  // ── Localhost loopback OAuth ──────────────────────────────────────────────
  // Запускаем временный HTTP-сервер, открываем браузер, ждём редиректа
  _getMicrosoftAuthCode(onStatus) {
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => {
        try {
          const url   = new URL(req.url, 'http://localhost')
          const code  = url.searchParams.get('code')
          const error = url.searchParams.get('error')

          if (code) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(SUCCESS_HTML)
            server.close()
            resolve({ code, redirectUri: `http://localhost:${port}` })
          } else {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(ERROR_HTML(error || 'Неизвестная ошибка'))
            server.close()
            reject(new Error(error || 'Авторизация отменена'))
          }
        } catch (e) {
          res.writeHead(500)
          res.end('Internal error')
          server.close()
          reject(e)
        }
      })

      // Таймаут 10 минут — если пользователь не завершил вход
      const timeout = setTimeout(() => {
        server.close()
        reject(new Error('Время ожидания истекло (10 минут). Попробуйте ещё раз.'))
      }, 10 * 60 * 1000)

      server.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })

      // port=0 → ОС выбирает свободный порт автоматически
      let port
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port
        const redirectUri = `http://localhost:${port}`

        const params = new URLSearchParams({
          client_id:     CLIENT_ID,
          response_type: 'code',
          redirect_uri:  redirectUri,
          scope:         'XboxLive.signin offline_access',
          prompt:        'select_account'
        })

        const authUrl = `${MS_AUTH_URL}?${params.toString()}`
        shell.openExternal(authUrl)
        if (onStatus) onStatus('Браузер открыт — войдите в аккаунт Microsoft...')
      })

      // Закрываем сервер при завершении промиса
      server.once('close', () => clearTimeout(timeout))
    })
  }

  // ── Обменять code на MS access_token ─────────────────────────────────────
  async _getMicrosoftToken(code, redirectUri) {
    const res = await axios.post(MS_TOKEN_URL,
      new URLSearchParams({
        client_id:    CLIENT_ID,
        code,
        grant_type:   'authorization_code',
        redirect_uri: redirectUri   // должен совпадать с тем что был при запросе кода
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15000 }
    )
    return res.data
  }

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

  async _getMinecraftToken(xstsToken, uhs) {
    const res = await axios.post(MC_AUTH_URL,
      { identityToken: `XBL3.0 x=${uhs};${xstsToken}` },
      { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
    )
    return res.data
  }

  async _getMinecraftProfile(mcToken) {
    const res = await axios.get(MC_PROFILE, {
      headers: { Authorization: `Bearer ${mcToken}` },
      timeout: 15000
    })
    return res.data
  }
}

module.exports = new Auth()
