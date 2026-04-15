# ⚡ CraftSync Launcher

Личный Minecraft лаунчер с синхронизацией модпаков через GitHub.

---

## Быстрый старт

### 1. Установить Node.js
Скачай [Node.js LTS](https://nodejs.org/) и установи. Проверь:
```bash
node --version   # должно быть v18+
npm --version
```

### 2. Установить зависимости
Открой папку проекта в терминале (PowerShell или CMD):
```bash
cd путь\к\MinecraftModLauncher
npm install
```

### 3. Запустить лаунчер
```bash
npm start
```

---

## Настройка GitHub для сборок

### Шаг 1 — Создай репозиторий на GitHub
Например: `github.com/ВАШ_НИК/mc-modpacks`

### Шаг 2 — Создай manifest.json
Положи файл `manifest.json` в корень репозитория:

```json
{
  "version": "1.0.0",
  "updatedAt": "2024-01-01",
  "modpacks": [
    {
      "id": "my-modpack",
      "name": "Моя Сборка",
      "version": "1.0.0",
      "mcVersion": "1.20.1",
      "loader": "forge",
      "loaderVersion": "47.2.0",
      "description": "Описание сборки",
      "icon": "🏔️",
      "bannerColor": "purple",
      "featured": true,
      "totalMods": 50,
      "sizeMb": 1500,
      "mods": [
        {
          "name": "JEI",
          "filename": "jei-1.20.1-forge-15.2.0.27.jar",
          "url": "https://github.com/ВАШ_НИК/mc-modpacks/releases/download/v1.0.0/jei.jar",
          "sha256": "хэш_файла_необязательно",
          "sizeMb": 2.4,
          "required": true
        }
      ]
    }
  ]
}
```

### Шаг 3 — Загрузи моды через GitHub Releases
1. Зайди в репозиторий → Releases → Create a new release
2. Создай тег `v1.0.0`
3. Прикрепи .jar файлы модов
4. Ссылки на файлы вставь в manifest.json (поле `url`)

### Шаг 4 — Укажи URL в лаунчере
В лаунчере → Настройки → GitHub Манифест:
```
https://raw.githubusercontent.com/ВАШ_НИК/mc-modpacks/main/manifest.json
```

---

## Структура проекта

```
MinecraftModLauncher/
├── main.js              ← Electron главный процесс
├── preload.js           ← Безопасный мост IPC
├── package.json         ← Зависимости
├── renderer/
│   ├── index.html       ← UI (главный экран)
│   ├── style.css        ← Стили
│   └── renderer.js      ← Логика UI
├── src/
│   ├── settings.js      ← Хранение настроек
│   ├── manifest.js      ← Получение списка сборок
│   ├── downloader.js    ← Скачивание модов
│   └── launcher.js      ← Запуск Minecraft
└── assets/
    └── icon.png         ← Иконка приложения
```

---

## Сборка в .exe (Windows)

```bash
npm run build
```
Готовый установщик появится в папке `dist/`.

---

## Цвета банеров карточек (поле bannerColor)

| Значение | Цвет        |
|----------|-------------|
| purple   | Фиолетовый  |
| pink     | Розовый     |
| blue     | Синий       |
| teal     | Морской     |
| dark     | Тёмный      |

---

## Загрузчики (поле loader)

- `forge` — Minecraft Forge
- `fabric` — Fabric Loader
- `quilt` — Quilt Loader
- `neoforge` — NeoForge
- `vanilla` — без загрузчика
