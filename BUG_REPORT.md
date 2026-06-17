# Финальное ревью DocuMind

***

## 🔴 Точно ошибка — воспроизводится гарантированно

### Б-1. `local-lmstudio` не имеет `imageEncoding` — отправляет `data-url`
**Файл:** `config/config.jsonc` 

LM Studio с Qwen3.6 отклоняет `data:image/webp;base64,...`. Это и есть твой `400 Bad Request`. Дефолт в `imageToPayload` — `'data-url'`, а у профиля нет переопределения. 

**Фикс:**
```jsonc
"local-lmstudio": {
  ...
  "imageEncoding": "base64-prefixed"
}
```

***

### Б-2. `rasterize-first-page.js` — NPE на `context.document.id`
**Файл:** `src/components/rasterize-first-page.js` 

```js
const document = context.document || context.artifacts.document;
const docId = context.document.id;  // ← всегда context.document, не document
```
Если `context.document` — `undefined`, строка с `docId` падает с `Cannot read properties of undefined`. Переменная `document` объявлена выше — но не используется для `docId`.

**Фикс:** `const docId = document.id;`

***

### Б-3. `normalize-fields.js` — двойное присваивание в `collectFields`
**Файл:** `src/components/normalize-fields.js` 

```js
for (const [key, value] of Object.entries(raw)) {
  if (Array.isArray(value) || (value && typeof value === 'object')) {
    collectFields(value, target);  // рекурсия
  } else {
    target[key] = value;
  }
  target[key] = value;  // ← ВСЕГДА перезаписывает, включая случай с объектом/массивом
}
```
Последняя строка `target[key] = value` стоит вне `else` — она выполняется всегда. Если `value` — вложенный объект, после рекурсивного обхода он тут же записывается как сырой объект, затирая уже разобранные вложенные поля. Это явный логический баг: рекурсивная flatten-логика ломается для любого вложенного JSON.

**Фикс:** убрать `target[key] = value` из тела цикла (за пределами `else`), либо переместить внутрь `else`.

***

### Б-4. `llm.js` — `content` может быть массивом, `parseJsonLenient` получит `[object Object]`
**Файл:** `src/lib/llm.js` 

Qwen3 в ряде режимов возвращает `content` как массив `[{ type: 'text', text: '...' }, { type: 'thinking', ... }]`. Код не обрабатывает это:
```js
const contentText = json.choices?.[0]?.message?.content;
```
Если `content` — массив, `parseJsonLenient` вернёт `null`, компонент вернёт `LLM_JSON_INVALID`. Отлажено рабочим кодом из другого проекта — там есть `normalizeContent`.

**Фикс:**
```js
const rawContent = json.choices?.[0]?.message?.content;
const contentText = Array.isArray(rawContent)
  ? rawContent.map(p => p?.text ?? '').filter(Boolean).join('\n')
  : (rawContent ?? '');
```

***

## 🟡 Возможная ошибка — зависит от окружения/данных

### В-1. Порядок `content[]` — image перед text
**Файл:** `src/lib/llm.js` 

```js
content.push({ type: 'image_url', ... });
content.push({ type: 'text', text: prompt });
```
Рабочий код из другого проекта отправляет text→image. Некоторые версии LM Studio и Qwen чувствительны к порядку. Не воспроизводится стабильно, но может быть источником плавающих отказов.

***

### В-2. `pdfDocument.numPages` читается после `cleanup()`
**Файл:** `src/components/rasterize-first-page.js` 

```js
page.cleanup();
await pdfDocument.cleanup();
// ...
return { ..., pages: pdfDocument.numPages }
```
По спеке pdfjs-dist, `cleanup()` освобождает ресурсы. `numPages` может быть undefined после этого — зависит от версии.

**Фикс:** `const numPages = pdfDocument.numPages;` до `cleanup()`.

***

### В-3. MIME-тип для не-PNG/WebP входных изображений
**Файл:** `src/lib/llm.js` 

```js
const ext = image.path.toLowerCase().endsWith('.png') ? 'png' : 'webp';
```
JPEG, BMP, TIFF — всё уйдёт как `data:image/webp;base64,...`. Пока входные файлы — только PDF (рендерится в webp) или изображения, конвертируемые через Sharp — практически не воспроизводится. Но при прямой передаче JPEG в pipeline — сломается.

***

### В-4. `write-output.js` — `selectedDocType` никогда не кладётся в `context.artifacts`
**Файл:** `src/components/write-output.js` 

```js
const naming = context.artifacts.selectedDocType?.crmNaming
  || { template: '{docType}_{createdAtDate}_{counter}' };
```
`selectedDocType` нигде не устанавливается ни одним компонентом — ни в `llm-universal-pass`, ни в `build-specific-prompt`, ни в `normalize-fields`. Всегда падает на дефолт. `crmNaming` из doc_type конфига никогда не применяется — имена файлов output всегда по шаблону-заглушке.

***

## 🔵 Нужно проверить / уточнить / тест

### П-1. Таймаут не покрывает `response.json()`
**Файл:** `src/lib/llm.js` 

`clearTimeout(timeout)` вызывается сразу после `fetch()`, до чтения тела. Ollama/LM Studio при большом ответе (dense JSON с extraction) может медленно отдавать тело — зависания без таймаута. **Проверить на реальных документах с большим вторым проходом.**

***

### П-2. Сессия: lifecycle размазан между оркестратором и компонентами
**Файлы:** `src/orchestrator.js`, `llm-universal-pass.js`, `llm-specific-pass.js` 

Оркестратор создаёт сессию при `imagePolicy === 'session'` и закрывает после цикла. Компоненты создают и закрывают сессию сами, если её нет в контексте. `closeSession` сейчас — no-op, поэтому не ломается. Но если `closeSession` получит реальную логику (например flush буфера или HTTP disconnect) — поведение станет непредсказуемым. **Нужно определить единственного владельца сессии.**

***

### П-3. `shouldSendImage` — нет явного `case 'session'`
**Файл:** `src/lib/llm.js` 

```js
if (policy === 'each-pass') return true;
if (policy === 'first-pass-only') return passName === 'universal';
return passName === 'universal'; // срабатывает и для 'session', и для неизвестных значений
```
Поведение для `'session'` и для опечатки в конфиге — одинаковое, без предупреждения. **Добавить явный case + `console.warn` на unknown policy.**

***

### П-4. `configDoctor` не проверяет дубликаты `step.id`
**Файл:** `src/orchestrator.js` 

Два шага с одинаковым `id` не детектируются. `stage` в ошибках станет неоднозначным. **Добавить проверку в `configDoctor`.**

***

### П-5. Нет guard на неподдерживаемые форматы в `rasterize-first-page`
**Файл:** `src/components/rasterize-first-page.js` 

`.docx`, `.txt`, неизвестные расширения попадают в `copyImageFirstPage` → Sharp бросает невнятную ошибку. **Добавить whitelist расширений и `{ ok: false }` с понятным сообщением.**

***

### П-6. `meta.input` не валидируется оркестратором
**Файлы:** все компоненты + `orchestrator.js` 

Если предыдущий шаг упал и artifact отсутствует — компонент получает `undefined` и падает с нечитаемой ошибкой вместо структурированного `{ ok: false }`. **Рассмотреть pre-run проверку `meta.input` против `context.artifacts`.**

***

## Сводная таблица

| ID | Файл | Статус | Суть |
|----|------|--------|------|
| Б-1 | `config.jsonc` | 🔴 Баг | `imageEncoding` отсутствует у `local-lmstudio` → 400 |
| Б-2 | `rasterize-first-page.js` | 🔴 Баг | `context.document.id` вместо `document.id` → NPE |
| Б-3 | `normalize-fields.js` | 🔴 Баг | `collectFields` — двойное присваивание ломает flatten |
| Б-4 | `llm.js` | 🔴 Баг | `content` как массив → `parseJsonLenient` → `null` |
| В-1 | `llm.js` | 🟡 Возможная | Порядок image/text в content[] |
| В-2 | `rasterize-first-page.js` | 🟡 Возможная | `numPages` после `pdfDocument.cleanup()` |
| В-3 | `llm.js` | 🟡 Возможная | MIME-тип для JPEG/других форматов |
| В-4 | `write-output.js` | 🟡 Возможная | `selectedDocType` никогда не задаётся → crmNaming не работает |
| П-1 | `llm.js` | 🔵 Тест | Таймаут не покрывает `response.json()` |
| П-2 | `orchestrator.js` + passes | 🔵 Уточнить | Lifecycle сессии размазан |
| П-3 | `llm.js` | 🔵 Уточнить | `shouldSendImage` без явного `case 'session'` |
| П-4 | `orchestrator.js` | 🔵 Уточнить | `configDoctor` не проверяет дубли `step.id` |
| П-5 | `rasterize-first-page.js` | 🔵 Уточнить | Нет guard на неподдерживаемые расширения |
| П-6 | все компоненты | 🔵 Уточнить | `meta.input` не валидируется перед запуском |

***

Приоритет исправлений: Б-1 → Б-4 → Б-3 → Б-2 → В-4, остальное по желанию. Начинать с Б-1 — без этого pipeline вообще не работает с LM Studio.