# BUG_REPORT — DocuMind

Дата ревью: **2026-07-18** (предыдущее: 2026-06-18)

Ревью охватывало весь проект:

- `src/lib/llm.js`
- `src/components/*.js` (все 8)
- `src/orchestrator.js`
- `src/prompt-builder.js`
- `src/doc-type-registry.js`
- `src/test/golden-runner.js`
- `config/config.jsonc`
- `config/doc_types/*.json`
- `config/prompts/templates/*.md`
- `docs/ARCHITECTURE.md`, `docs/PROMPTS.md`, `docs/GOLDEN_SET.md`
- `Ollama.md`, `README.md`, `CONTEXT.md`

---

## Сводная таблица

| ID | Файл | Статус | Суть |
|---|---|---|---|
| Б-1 | `config.jsonc` | ✅ Исправлен | `local-lmstudio`: `imageEncoding: "base64-prefixed"` и `lmStudioCompat: true` |
| Б-2 | `rasterize-first-page.js` | ✅ Устарел как блокер | Ошибка в старом компоненте; MVP использует `assemble-document-pdf` |
| Б-3 | `normalize-fields.js` | ✅ Исправлен | `collectFields` переписан без двойного присваивания |
| Б-4 | `src/lib/llm.js` | ✅ Исправлен | `content` как массив обрабатывается через `normalizeContent()` |
| Б-5 | `src/lib/llm.js` | ✅ Исправлен (2026-06-18) | RouterAI: `ROUTERAI_API_KEY` не читался из `.env` |
| В-1 | `src/lib/llm.js` | ✅ Исправлен | Prompt/text теперь идёт перед image |
| В-2 | `assemble-document-pdf.js` | ✅ Исправлен | Количество страниц сохраняется до cleanup |
| В-3 | `assemble-document-pdf.js` / `llm.js` | ✅ Частично | PDF и изображения приводятся к JPEG |
| В-4 | `normalize-fields.js` / `write-output.js` | ✅ Исправлен | Итоговый JSON плоский |
| П-7 | `src/orchestrator.js` | ✅ Исправлен | `docId` не строится из имени файла |
| П-8 | `assemble-document-pdf.js` | ✅ Исправлен | Image Width/Height округляются до целых |
| **C-2** | **`src/lib/llm.js` + `config.jsonc`** | **✅ Исправлен (2026-07-18)** | **Ollama `num_ctx` не передавался — молчаливое усечение документов (см. `Ollama.md`)** |
| **C-3** | **`normalize-fields.js`** | **✅ Исправлен (2026-07-18)** | **`collectFields` — потенциальная бесконечная рекурсия / stack overflow** |
| **H-2** | **`golden-runner.js`** | **✅ Исправлен (2026-07-18)** | **Сравнивал `actual.fields`, но итоговый JSON — плоский (поля на верхнем уровне)** |
| H-1 | `config.jsonc` | 🔵 Открыт | `prod-ollama.baseUrl` = `127.0.0.1` вместо офисного сервера |
| H-3 | `normalize-fields.js` | 🔵 Открыт | `applyTypeAliases` хардкодит алиасы полей вместо чтения из конфига |
| M-1 | `write-output.js` | 🔵 Открыт | `sanitizeFileNamePart` вырезает кавычки `«»"` — ломает имена с `ООО "Название"` |
| M-2 | `assemble-document-pdf.js` | 🔵 Открыт | `page.cleanup()` в finally без try/catch — может подавить оригинальную ошибку рендеринга |
| П-1 | `src/lib/llm.js` | 🔵 Открыт | Таймаут не покрывает `response.json()` |
| П-2 | `orchestrator.js` + passes | 🔵 Открыт | Lifecycle сессии размазан между оркестратором и LLM-компонентами |
| П-3 | `src/lib/llm.js` | 🔵 Открыт | `shouldSendImage`: поведение `session` и unknown одинаково |
| П-4 | `orchestrator.js` | 🔵 Открыт | `configDoctor` не проверяет дубли `step.id` |
| П-5 | `assemble-document-pdf.js` | 🔵 Открыт | Нужен более явный guard на неподдерживаемые расширения |
| П-6 | все компоненты | 🔵 Открыт | `meta.input` не валидируется оркестратором перед запуском |
| П-9 | `discover-documents.js` | 🔵 Открыт | `entry.path ?? entry.parentPath ?? dir` — хрупкий обход различий Node.js API |

---

## Что исправлено 2026-07-18

### C-2. Ollama `num_ctx` — молчаливое усечение документов

**Файлы:** `src/lib/llm.js`, `config/config.jsonc`  
**Связан:** `Ollama.md`

Проблема детально разобрана в `Ollama.md`:

- Ollama по умолчанию имеет **`num_ctx = 2048`** токенов (~1.5 страницы текста)
- При превышении — **молча вытесняет первые токены**, модель «видит» только конец документа
- Модель галлюцинирует или ломает JSON → парсер падает с невнятной ошибкой

**Исправление (два шага):**

**Шаг 1 — `src/lib/llm.js`:** после формирования thinking-параметров добавлено:
```js
// Ollama num_ctx override — critical for legal documents.
// Ollama defaults to 2048 tokens, silently evicting earlier tokens when exceeded.
// See Ollama.md for the full analysis.
if (profile.numCtx) {
  body.options = { num_ctx: profile.numCtx };
}
```

**Шаг 2 — `config/config.jsonc`:** в профиль `prod-ollama` добавлено:
```jsonc
"numCtx": 32768
```

**Важно (из Ollama.md):** при `num_ctx: 32768` на слабом железе возможен OOM. Мониторить VRAM при первых запусках.

---

### C-3. `collectFields` — потенциальная бесконечная рекурсия

**Файл:** `src/components/normalize-fields.js`

Функция `collectFields` рекурсивно обходит объект без ограничения глубины. Циклическая ссылка или глубокая вложенность → stack overflow.

**Исправление:** добавлен параметр `depth` и guard:
```js
function collectFields(raw, target = {}, prefix = '', depth = 0) {
  if (depth > 20) return target;
  // ...
  collectFields(value, target, nextPrefix, depth + 1);
}
```

---

### H-2. `golden-runner.js` — сравнение несуществующего поля

**Файл:** `src/test/golden-runner.js`

Было:
```js
const passed = actual && deepEqual(actual.fields, expected.fields) && actual.docType === expected.docType;
```
Итоговый JSON — плоский, `actual.fields` всегда `undefined`. Сравнение не работало.

**Исправление:**
```js
const fieldMatch = expected.fields
  ? Object.entries(expected.fields).every(([k, v]) => actual?.[k] === v)
  : true;
const passed = actual && actual.docType === expected.docType && fieldMatch;
```

---

## Что осталось открытым

### H-1. `prod-ollama.baseUrl` — localhost вместо офисного сервера

**Файл:** `config/config.jsonc`

```jsonc
"prod-ollama": {
  "baseUrl": "http://127.0.0.1:11434/v1",
```

`127.0.0.1` = localhost. В CONTEXT.md написано «Linux/on-prem office server». Нужно заменить на реальный IP сервера или оставить с явным FIXME-комментарием.

---

### H-3. `applyTypeAliases` — хардкод вместо конфига

**Файл:** `src/components/normalize-fields.js`

Для каждого типа документа жёстко зашиты алиасы полей. При добавлении нового типа придётся лезть в код. Алиасы должны быть в `config/doc_types/*.json`.

---

### M-1. `sanitizeFileNamePart` вырезает кавычки

**Файл:** `src/components/write-output.js`, строка 15

```js
.replace(/[\\/:*?"<>|«»„“'"]/g, ' ')
```

Для `short_name_ru = ООО "Техноресурс Плюс"` имя файла станет с двойными пробелами. Нужно заменять кавычки на безопасный символ, а не удалять.

---

### M-2. `page.cleanup()` без try/catch

**Файл:** `src/components/assemble-document-pdf.js`

```js
} finally {
  page.cleanup();  // если бросит — заменит оригинальную ошибку
}
```

Нужно обернуть в try/catch.

---

## История изменений

| Дата | Действие |
|---|---|
| 2026-06-18 | Первое ревью: баги Б-1…Б-4, В-1…В-4, П-1…П-8 |
| 2026-06-18 | MVP: one-pass extraction, grouped document assembly, реальные типы, output naming |
| 2026-06-18 | Исправлены пустые PDF, плоский JSON, `docId` без имени файла |
| 2026-06-18 | Б-5: RouterAI API key + `reasoning_effort: "none"` |
| 2026-07-18 | Второе ревью: C-2, C-3, H-1…H-3, M-1…M-2, П-9 |
| **2026-07-18** | **Исправлены C-2 (Ollama num_ctx), C-3 (collectFields recursion), H-2 (golden-runner fields)** |
