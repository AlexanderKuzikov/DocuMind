# BUG_REPORT — DocuMind

Дата ревью: **2026-06-18**

Ревью охватывало:

- `src/lib/llm.js`;
- `src/components/llm-universal-pass.js`;
- `src/components/llm-specific-pass.js`;
- `src/components/rasterize-first-page.js`;
- `src/components/normalize-fields.js`;
- `src/components/write-output.js`;
- `src/orchestrator.js`;
- `config/config.jsonc`;
- `config/doc_types/*.json`;
- `config/prompts/templates/*.md`.

---

## Сводная таблица

| ID | Файл | Статус | Суть |
|---|---|---|---|
| Б-1 | `config/config.jsonc` | ✅ Исправлен | `local-lmstudio` получил `imageEncoding: "base64-prefixed"` и `lmStudioCompat: true` |
| Б-2 | `rasterize-first-page.js` | ✅ Устарел как блокер | Ошибка была в старом компоненте; активный MVP использует `assemble-document-pdf` |
| Б-3 | `normalize-fields.js` | ✅ Исправлен | `collectFields` переписан без двойного присваивания |
| Б-4 | `src/lib/llm.js` | ✅ Исправлен | `content` как массив обрабатывается через `normalizeContent()` |
| В-1 | `src/lib/llm.js` | ✅ Исправлен | Prompt/text теперь идёт перед image |
| В-2 | `assemble-document-pdf.js` | ✅ Исправлен в новом компоненте | Количество страниц сохраняется до cleanup |
| В-3 | `assemble-document-pdf.js` / `src/lib/llm.js` | ✅ Частично закрыто | PDF и изображения в MVP приводятся к JPEG; MIME guard остаётся желательным для legacy-кода |
| В-4 | `normalize-fields.js` / `write-output.js` | ✅ Исправлен | `selectedDocType` задаётся в normalize и применяется в write-output |
| П-1 | `src/lib/llm.js` | 🔵 Остался риск | Таймаут не покрывает `response.json()` |
| П-2 | `orchestrator.js` + passes | 🔵 Остался риск | Lifecycle сессии размазан между оркестратором и LLM-компонентами |
| П-3 | `src/lib/llm.js` | 🔵 Остался риск | `shouldSendImage` лучше сделать более явным |
| П-4 | `orchestrator.js` | 🔵 Остался риск | `configDoctor` не проверяет дубли `step.id` |
| П-5 | `assemble-document-pdf.js` | 🔵 Остался риск | Нужен более явный guard на неподдерживаемые расширения |
| П-6 | все компоненты | 🔵 Остался риск | `meta.input` не валидируется оркестратором перед запуском |

---

## Что исправлено в MVP-режиме

### 1. Удалены выдуманные типы документов

Были удалены старые demo-типы:

```text
passport
invoice
marriage_certificate
traffic_accident_appendix
```

Добавлены реальные MVP-типы:

```text
egrul_extract
vehicle_registration_certificate
traffic_accident_participants
```

---

### 2. Активный pipeline переведён в one-pass режим

Активный pipeline:

```text
discover-documents
assemble-document-pdf
build-universal-prompt
llm-universal-pass
normalize-fields
write-output
```

Старые компоненты оставлены, но отключены в `config/config.jsonc`.

---

### 3. Документ собирается в единый PDF

Новый компонент:

```text
src/components/assemble-document-pdf.js
```

Он собирает один PDF для:

- одного top-level файла;
- одной top-level папки с несколькими файлами;
- PDF-документов;
- PNG/JPG/WebP изображений.

---

### 4. Исправлена нормализация полей

`normalize-fields.js` теперь:

- читает `docType` из one-pass JSON;
- извлекает поля по техническим ключам;
- проверяет required fields;
- нормализует даты;
- задаёт `selectedDocType`.

---

### 5. Исправлено именование output

`write-output.js` теперь применяет `outputNaming` из `config/doc_types/*.json`.

Примеры:

```text
Выписка из ЕГРЮЛ ООО ТЕХНОРЕСУРС ПЛЮС от 2025-12-10.pdf
СТС M57TM159.pdf
Сведения об участниках ДТП 2024-11-16.pdf
```

Рядом сохраняется JSON с тем же именем.

---

## Актуальные открытые задачи

### П-1. Таймаут не покрывает `response.json()`

**Файл:** `src/lib/llm.js`

`clearTimeout(timeout)` вызывается сразу после `fetch()`, до чтения тела ответа. При большом ответе может быть зависание.

**Действие:** перенести очистку таймера после чтения/парсинга тела ответа.

---

### П-2. Lifecycle сессии размазан

**Файлы:**

```text
src/orchestrator.js
src/components/llm-universal-pass.js
src/components/llm-specific-pass.js
src/lib/llm.js
```

Оркестратор создаёт сессию при `imagePolicy: "session"`, но LLM-компоненты также умеют создавать свои short-lived sessions.

**Действие:** определить единственного владельца сессии.

---

### П-3. `shouldSendImage` лучше сделать явнее

**Файл:** `src/lib/llm.js`

Сейчас поведение для `session` и неизвестных policy похоже.

**Действие:** добавить явный `case 'session'` и warn на unknown policy.

---

### П-4. `configDoctor` не проверяет дубли `step.id`

**Файл:** `src/orchestrator.js`

Два шага с одинаковым `id` не детектируются.

**Действие:** добавить проверку уникальности `step.id`.

---

### П-5. Guard на неподдерживаемые расширения

**Файл:** `src/components/assemble-document-pdf.js`

Сейчас поддерживаются:

```text
.pdf
.png
.jpg
.jpeg
.webp
```

**Действие:** добавить понятную ошибку для неподдерживаемых файлов внутри документа.

---

### П-6. `meta.input` не валидируется перед запуском

**Файлы:** все компоненты + `src/orchestrator.js`

Если предыдущий шаг упал и artifact отсутствует, следующий компонент может получить `undefined`.

**Действие:** рассмотреть pre-run проверку `meta.input` против `context.artifacts`.

---

## История изменений

| Дата | Действие |
|---|---|
| 2026-06-18 | Первое ревью кода, зафиксированы баги Б-1…Б-4, В-1…В-4, П-1…П-6 |
| 2026-06-18 | MVP-режим: one-pass extraction, grouped document assembly, реальные типы документов, output naming, field mappings |
