# CODE_REVIEW — DocuMind

**Дата:** 2026-07-18  
**Ревизор:** goose (OpenCode Go)  
**Объём:** 19 source files, 7 config/prompt files, 7 doc files, ~2400 LOC

---

## 1. Общий вердикт

Проект на стадии **MVP foundation / demo-ready** — и это честно. Архитектура компонентного оркестратора с config-driven pipeline выбрана правильно. Код содержит **2 критических бага** (оба исправлены), 3 проблемы высокого приоритета (1 исправлена) и несколько средних. После полного закрытия — можно переходить к production-тестированию на реальных документах через Ollama.

### Оценки по категориям

| Категория | Оценка | Комментарий |
|---|---|---|
| Архитектура | ⭐⭐⭐⭐ | Компонентный pipeline + config-driven doc types — грамотно |
| Качество кода | ⭐⭐⭐ | Местами переусложнено (хардкод в normalize-fields), местами недомолвки (session lifecycle) |
| Обработка ошибок | ⭐⭐⭐⭐ | Структурированные ошибки с `code/message/stage/suggestions` — отлично |
| Документация | ⭐⭐⭐ | README/CONTEXT хороши, Ollama.md детальный, но был разрыв с реализацией |
| Безопасность | ⭐⭐⭐⭐ | Данные не текут наружу, production policy описана, env для ключей |
| Тестирование | ⭐⭐ | Golden runner есть, fixtures пустые |

---

## 2. Архитектура

### 2.1 Что сделано хорошо

**Компонентный подход.** Каждый компонент в `src/components/` экспортирует `meta` (id, version, input, output) и `run(context)`. Компоненты не импортируют друг друга — общаются через `context.artifacts`. Это правильный паттерн для pipeline-оркестратора.

**Config-driven doc types.** Типы документов описаны в `config/doc_types/*.json`, содержат поля, алиасы, признаки распознавания, правила валидации, шаблоны имён. Добавление нового типа = новый JSON-файл, без правки кода. За исключением `applyTypeAliases` — см. H-3.

**Структурированные ошибки.** Каждая ошибка содержит `code`, `message`, `stage`, `recoverable`, `probableCauses`, `suggestions`. Это production-grade подход.

**Pipeline lock.** И CLI, и UI защищены локом от параллельных запусков. Правильно.

**Обработка thinking mode.** Тройная защита для отключения thinking (Anthropic/vLLM/OpenRouter стили) — грамотное решение для совместимости с разными провайдерами.

### 2.2 Архитектурные проблемы

**Session lifecycle (П-2).** Оркестратор создаёт сессию при `imagePolicy: "session"`, но LLM-компоненты (`llm-universal-pass.js`, `llm-specific-pass.js`) тоже умеют создавать свои short-lived sessions. Два источника истины для управления сессией. Решение: либо оркестратор всегда владеет сессией, либо наоборот.

**Хардкод алиасов полей (H-3).** `normalize-fields.js:applyTypeAliases()` содержит жёстко зашитые маппинги для каждого типа документа. Это противоречит принципу config-driven, заявленному в README.

**Дублирование логики сборки PDF.** `assemble-document-pdf.js` и `rasterize-first-page.js` содержат идентичный код для `loadPdfJs()`, `NodeCanvasFactory`, `ensureCanvasGlobals()`. Вынести в `src/lib/pdf-utils.js`.

---

## 3. Качество кода

### 3.1 `src/lib/llm.js`

**Плюсы:**
- `normalizeContent()` обрабатывает и строки, и массивы, и `<think>` блоки
- `imageToPayload()` поддерживает три режима кодирования + LM Studio workaround
- Тройная защита thinking mode
- ✅ **C-2 исправлен:** добавлена передача `options.num_ctx` для Ollama

**Минусы:**
- **П-1:** `clearTimeout(timeout)` в finally после `response.json()` — таймаут не прервёт чтение тела ответа при зависании
- `shouldSendImage` экспортируется из `llm.js`, но логически относится к оркестратору

### 3.2 `src/orchestrator.js`

**Плюсы:**
- Pipeline lock через цепочку Promise
- `applyLlmOverrides` — чистый паттерн переопределения
- `maxDocumentsPerRun: 0 = no limit` — документировано в коде

**Минусы:**
- **П-4:** `configDoctor` не проверяет дубли `step.id`
- `pipelineExecution` — глобальная переменная модуля, не изолирована между разными импортами
- `counters: { output: 1 }` — starts at 1, not 0. Нужен комментарий.

### 3.3 `src/prompt-builder.js`

**Плюсы:**
- Чистые функции рендеринга через `{{mustache}}`
- Автоматическая сборка полей из docTypes
- Полный набор: `buildOnePassPrompt`, `buildUniversalPrompt`, `buildSpecificPrompt`, `buildUnknownPrompt`

**Минусы:**
- `buildSecondPassFields` использует кракозябры как fallback-строку — заменить на `'No second-pass fields defined'`
- `render` не экранирует специальные символы в значениях (не критично для промптов)

### 3.4 `src/components/normalize-fields.js`

**Плюсы:**
- Нормализация дат: поддержка и `DD.MM.YYYY`, и `YYYY-MM-DD`
- `normalizeField` — цепочка правил, легко расширять
- `pickField` — умный выбор по алиасам
- ✅ **C-3 исправлен:** `collectFields` с ограничением глубины `depth > 20`

**Минусы:**
- **H-3:** `applyTypeAliases` — хардкод вместо конфига
- Тип `array` нормализуется только в конце — если до него были `uppercase`/`trim`, применятся к массиву как к строке

### 3.5 `src/components/assemble-document-pdf.js`

**Плюсы:**
- Ручная сборка PDF — жирный и рабочий ход
- Поддержка многостраничных PDF и одиночных изображений
- Конвертация всего в JPEG для единообразия

**Минусы:**
- **M-2:** `page.cleanup()` в finally без try/catch — может подавить оригинальную ошибку
- `buildPdf` собирает PDF как Buffer.concat строк и буферов — работает, но хрупко. Для production лучше `pdf-lib`.
- `SUPPORTED_IMAGE_EXTENSIONS` (`.bmp`, `.tiff`, `.tif`) не совпадает с `SUPPORTED_EXTENSIONS` в `discover-documents.js`

### 3.6 `src/components/write-output.js`

**Плюсы:**
- `uniqueOutputPath` с автоинкрементом до 999
- `stableStringify` для детерминированного JSON
- Удаление `outputNaming` из финального JSON

**Минусы:**
- **M-1:** `sanitizeFileNamePart` вырезает кавычки `«»"` — ломает имена типа `ООО "Название"`

### 3.7 `src/test/golden-runner.js`

**Плюсы:**
- Структура обхода golden-кейсов правильная

**Минусы:**
- ✅ **H-2 исправлен:** сравнение теперь идёт по плоским полям `actual[key]`, а не `actual.fields`
- `deepEqual` через `JSON.stringify` — нестабилен при разном порядке ключей
- Нет сравнения `pdfFileName` / `jsonFileName`
- `catch (_)` молча глотает ошибки чтения директории

### 3.8 `src/ui-server.js`

**Плюсы:**
- Поиск свободного порта в диапазоне
- Backup + rollback при сохранении конфига
- `safeJoin` с защитой от path traversal
- `configDoctor` после каждого сохранения

**Минусы:**
- 460 строк в одном файле — пора разбить на middleware/роуты
- Двойной импорт `jsonc-parser` (именованный + default)

---

## 4. Конфигурация

### 4.1 `config/config.jsonc`

**Замечания:**
- `activeProfile: "mvp-routerai"` — активный профиль по умолчанию указывает на внешний сервис. Для безопасности лучше `local-lmstudio` как дефолт.
- `extraction.universalFields` — массив строк, не используется нигде в коде. Мёртвый конфиг.
- ✅ **numCtx добавлен** в `prod-ollama` профиль: `"numCtx": 32768`
- `ui` секция в конфиге — порты дублируются с `ui-server.js`. Источник истины должен быть один.
- `rasterize.format: "jpeg"` vs расширение `.jpg` — мелкая нестыковка.

### 4.2 `config/doc_types/*.json`

**Замечания:**
- Дублирование: каждый тип имеет и `fields`, и `firstPassFields` с идентичным содержимым. В one-pass используются `fields`. `firstPassFields` — наследие two-pass.
- `crmNaming` и `outputNaming` дублируются — оставить один.

---

## 5. Документация

### 5.1 README.md — хорошо
Информативный, полный. Не хватает ссылки на `Ollama.md` в Known Issues и упоминания `numCtx` в секции prod-ollama.

### 5.2 CONTEXT.md — отлично
Лучший onboarding-документ в проекте. Нестыковка: `prod-ollama` описан как «Linux/on-prem office server», но baseUrl = `127.0.0.1`.

### 5.3 ARCHITECTURE.md — полный
Хороший architectural overview. Не хватает data flow диаграммы.

### 5.4 PROMPTS.md — детальный
Разбор всех промптов и JSON-контрактов.

### 5.5 GOLDEN_SET.md — описывает желаемое
Структура описана верно, но fixtures пустые.

### 5.6 Ollama.md — отличный технический разбор
**Ранее:** файл существовал как памятка, но код не реализовывал решение.  
**Исправлено:** `num_ctx` теперь передаётся через `options.num_ctx` в `llm.js` + `numCtx` в конфиге.

### 5.7 BUG_REPORT.md
Обновлён в рамках этого ревью.

---

## 6. Проблемы, замеченные при повторном чтении

### 6.1 Мёртвый код

| Файл | Что | Почему мёртвый |
|---|---|---|
| `rasterize-first-page.js` | Весь компонент | Заменён на `assemble-document-pdf`, отключен |
| `build-specific-prompt.js` | Весь компонент | Отключен в pipeline |
| `llm-specific-pass.js` | Весь компонент | Отключен в pipeline |
| `config.jsonc#extraction.universalFields` | Массив полей | Не используется в коде |

### 6.2 Нестыковки между компонентами

| Компонент A | Компонент B | Нестыковка |
|---|---|---|
| `discover-documents.js` | `assemble-document-pdf.js` | Разные `SUPPORTED_EXTENSIONS` |
| `normalize-fields.js` | `write-output.js` | `outputNaming` — лишний транзит через `finalDocument` |
| `orchestrator.js` | `llm-universal-pass.js` | Оба управляют сессией (П-2) |

---

## 7. Трассировка Ollama-проблемы (до исправления)

```
Пользователь кладёт PDF на 20 страниц в input/
  → assemble-document-pdf собирает PDF
  → build-universal-prompt рендерит промпт (~2K токенов)
  → llm-universal-pass отправляет image + prompt в Ollama
  → LlmClient.call формирует body БЕЗ options.num_ctx
  → Ollama использует num_ctx=2048 по умолчанию
  → Документ на 20 страниц = ~5000 токенов → 3000 токенов молча вытеснены
  → Модель «видит» только конец документа
  → Не видит ОГРН, дату, название (они в начале)
  → Галлюцинирует или возвращает null
  → Пользователь недоумевает
```

**После исправления (C-2):** `options.num_ctx = 32768` → 20 страниц помещаются → модель видит весь документ.

---

## 8. Приоритеты оставшихся исправлений

### Срочно (до production-тестов)
- ✅ ~~C-2: num_ctx в llm.js + конфиг~~ **Исправлено**
- ✅ ~~C-3: глубина рекурсии в collectFields~~ **Исправлено**
- ✅ ~~H-2: golden-runner сравнение полей~~ **Исправлено**

### Перед расширением типов документов
- H-3: перенести алиасы полей в конфиг
- M-1: исправить sanitizeFileNamePart для кавычек
- M-2: try/catch для page.cleanup()

### Технический долг (можно позже)
- П-1: таймаут для response.json()
- П-2: унифицировать session lifecycle
- П-4: проверка дублей step.id в configDoctor
- Вынести общий код pdf-js в `src/lib/pdf-utils.js`
- Разбить `ui-server.js` на модули
- Заменить ручную сборку PDF на `pdf-lib`

---

## 9. Заключение

Проект на правильном пути. Архитектура компонентного оркестратора с config-driven doc types — именно то, что нужно.

**Критические баги исправлены:**
- Ollama `num_ctx` теперь передаётся — самая опасная проблема для production закрыта
- `collectFields` защищён от бесконечной рекурсии
- Golden runner корректно сравнивает плоские поля

После закрытия H-3, M-1, M-2 проект готов к запуску на реальных документах через Ollama (с мониторингом VRAM на сервере).
