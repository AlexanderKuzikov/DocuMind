# CONTEXT

Этот файл предназначен для быстрого погружения новой LLM/агента в проект.

## Проект

DocuMind — Node.js orchestrator для config-driven извлечения юридически значимых данных из документов.

GitHub:

```text
https://github.com/AlexanderKuzikov/DocuMind
```

Текущий статус:

```text
MVP one-pass extraction / demo-ready
```

Это рабочая предварительная версия, но ещё не production-complete система.

---

## Текущий активный режим

Активный режим:

```text
input/
  → discover-documents
  → assemble-document-pdf
  → build-universal-prompt
  → llm-universal-pass
  → normalize-fields
  → write-output
  → output/<имя>.pdf
  → output/<имя>.json
```

Старый двухпроходный pipeline не удалён. Он оставлен в `src/components/` и может быть включён позже через config/UI:

```text
rasterize-first-page
build-specific-prompt
llm-specific-pass
```

---

## Что уже сделано

На текущем этапе в репозитории есть:

- Node.js проект с `package.json` и `package-lock.json`;
- CLI entrypoint `src/cli.js`;
- orchestrator `src/orchestrator.js`;
- компонентная архитектура в `src/components/`;
- config-driven pipeline через `config/config.jsonc`;
- реальные типы документов в `config/doc_types/*.json`;
- prompt templates в `config/prompts/templates/*.md`;
- LLM client в `src/lib/llm.js`;
- сборка документа в единый PDF через `assemble-document-pdf.js`;
- one-pass docType detection и field extraction;
- базовая нормализация;
- output writer с переименованием PDF/JSON;
- debug artifacts;
- `config:doctor` с проверкой paths, prompt templates, components, LLM profile и hard rules;
- `dry-run`;
- alias lookup для doc types;
- golden runner;
- README, CONTEXT, docs/ARCHITECTURE, docs/PROMPTS, docs/GOLDEN_SET, BUG_REPORT;
- локальный browser UI через `npm run ui`;
- UI save guard: backup, JSON/JSONC parse, `config:doctor`, prompt preview и rollback;
- вкладка Field Mappings в UI.

---

## Активные типы документов

Сейчас в MVP зарегистрированы только реальные типы:

| Technical key | Название | Обязательные поля |
|---|---|---|
| `egrul_extract` | Выписка из ЕГРЮЛ | `ogrn`, `registration_record_date`, `short_name_ru` |
| `vehicle_registration_certificate` | Свидетельство о регистрации ТС | `vin`, `vehicle_number` |
| `traffic_accident_participants` | Сведения об участниках ДТП | `accident_location`, `accident_date` |

Входящие имена файлов не используются для:

- определения типа документа;
- извлечения полей;
- именования результата.

Тип документа определяется по содержанию.

---

## Важные правила извлечения

### Выписка из ЕГРЮЛ

Поля:

```text
ogrn
registration_record_date
short_name_ru
```

Важно:

```text
registration_record_date — это дата внесения записи в ЕГРЮЛ, а не дата выписки.
```

Имя файла:

```text
Выписка из ЕГРЮЛ {short_name_ru} от {registration_record_date}
```

### Свидетельство о регистрации ТС

Поля:

```text
vin
vehicle_number
```

Имя файла:

```text
СТС {vehicle_number}
```

### Сведения об участниках ДТП

Поля:

```text
accident_location
accident_date
```

Важно:

```text
accident_location понимается как "Место ДТП", потому что это может быть адрес, трасса, участок дороги или иной ориентир.
```

Имя файла:

```text
Сведения об участниках ДТП {accident_date}
```

---

## Конфигурация

Основной конфиг:

```text
config/config.jsonc
```

Это JSONC, поэтому комментарии разрешены.

Секреты в конфиг не кладём. Ключи берём из env:

```env
ROUTERAI_API_KEY=
LOCAL_LLM_API_KEY=
INTERNAL_LLM_API_KEY=
```

Field mappings:

```text
config/field_mappings.json
```

Prompt templates:

```text
config/prompts/templates/*.md
```

Doc types:

```text
config/doc_types/*.json
```

---

## LLM profiles

Текущий активный профиль для быстрых тестов:

```json
{
  "activeProfile": "local-lmstudio"
}
```

LM Studio profile:

```json
{
  "baseUrl": "http://127.0.0.1:1234/v1",
  "model": "qwen3.6:35b-a3b",
  "apiKeyEnv": null,
  "imageEncoding": "base64-prefixed",
  "lmStudioCompat": true,
  "timeout": 300000
}
```

LM Studio в OpenAI-compatible режиме не требует API key.

Если LM Studio отдаёт другое имя модели, его надо поменять в `config/config.jsonc` в поле `llm.profiles["local-lmstudio"].model`.

RouterAI:

```text
mvp-routerai
RouterAI.ru
qwen/qwen3.6-35b-a3b
imageEncoding: base64-prefixed
```

Production target:

```text
prod-ollama
Linux/on-prem office server
Ollama
qwen3.6:35b-a3b
```

Температура:

```text
0
```

Thinking — экспериментально, пока отключено.

---

## Local UI

Команда:

```bash
npm run ui
```

Адрес:

```text
http://127.0.0.1:4173
```

Порт `3000` не используется. Сервер стартует с `4173` и при занятости перебирает `4174–4183`.

UI — это локальный dev-инструмент, не production admin panel.

Он умеет:

- редактировать `config/config.jsonc`;
- редактировать `config/doc_types/*.json`;
- редактировать `config/field_mappings.json`;
- редактировать prompt templates;
- сканировать `src/components/*.js`;
- читать `meta` компонентов;
- включать/выключать компоненты;
- менять `required`;
- менять порядок pipeline;
- удалять компонент из pipeline;
- добавлять новые компоненты, если они лежат в `src/components/` и экспортируют `meta`;
- запускать `config:doctor`, `dry-run`, `render prompt`, `extract`;
- смотреть файлы из `output/` и `debug/`.

Перед сохранением конфигов UI делает backup, JSON/JSONC parse, `config:doctor`, prompt preview и rollback на ошибку. `/api/actions/extract` использует тот же pipeline lock, что и CLI.

Источник истины для UI — `config/config.jsonc`. UI не должен иметь отдельный хардкодный список компонентов.

---

## DPI

Текущий MVP DPI:

```text
200
```

150/300 и разные DPI по типам документов — позже.

---

## Output

Финальный output:

```text
output/<имя>.pdf
output/<имя>.json
```

JSON должен быть плоским, без debug/internal-полей:

```json
{
  "docId": "dm-20260618113637-7a8f5289ed28-7263",
  "docType": "vehicle_registration_certificate",
  "docTypeName": "Свидетельство о регистрации ТС",
  "status": "ok",
  "confidence": 0.95,
  "vin": "X7L4SRLVA64034752",
  "vehicle_number": "M57TM159",
  "createdAt": "2026-06-18T11:36:47.504Z",
  "pdfFileName": "СТС M57TM159.pdf",
  "jsonFileName": "СТС M57TM159.json"
}
```

`docId` формируется как:

```text
dm-YYYYMMDDHHMMSS-<content-hash>-<run-suffix>
```

Он не зависит от имени входящего файла.

---

## Debug

Debug artifacts сохраняются в:

```text
debug/<docId>/
```

Содержимое для активного one-pass режима:

```text
one-pass.prompt.md
one-pass.response.json
output.json
```

Legacy debug artifacts могут сохраняться от старого pipeline:

```text
universal.prompt.md
universal.response.json
specific.prompt.md
specific.response.json
```

Debug можно отключать через `config/config.jsonc`.

---

## Golden set

Golden set — отдельный тестовый слой.

Структура должна быть такой:

```text
golden/
  egrul_extract/
    egrul_extract-001/
      input/
        document.pdf
      expected.json
      config.json

  vehicle_registration_certificate/
    vehicle_registration_certificate-001/
      input/
        document.pdf
      expected.json
      config.json

  traffic_accident_participants/
    traffic_accident_participants-001/
      input/
        document.pdf
      expected.json
      config.json
```

Текущий статус: runner есть, fixtures пока не добавлены.

---

## Known issues / risks

### Fixed in current MVP

- Б-1: `local-lmstudio` получил `imageEncoding: "base64-prefixed"`.
- Б-3: `normalize-fields` исправлен.
- Б-4: `llm.js` нормально обрабатывает `content` как массив.
- В-1: prompt/text идёт перед image.
- В-4: output naming больше не зависит от `selectedDocType` в итоговом JSON.
- Выдуманные типы документов удалены.
- Активный pipeline переведён в one-pass режим.
- Добавлена сборка документа в единый PDF.
- Исправлены дробные Width/Height в PDF image XObject.
- Итоговый JSON очищен от debug/internal-полей.
- `docId` больше не строится из имени входящего файла.
- Добавлены реальные output naming templates.

### Still open

- Нет полноценного golden set на реальных документах.
- RouterAI-профиль ещё нужно проверить на реальных документах.
- Ollama office server ещё нужно проверить.
- Таймаут в `llm.js` не покрывает `response.json()`.
- Lifecycle сессии размазан между orchestrator и LLM components.
- `shouldSendImage` лучше сделать более явным.
- `configDoctor` не проверяет дубликаты `step.id`.
- Нужен более явный guard на неподдерживаемые расширения файлов.
- `meta.input` компонентов не валидируется оркестратором перед запуском.

---

## Production data policy

Реальные юридические документы с персональными данными не отправляются во внешние LLM-сервисы.

Cloud-профили, включая RouterAI, разрешены только для:

```text
dev
sandbox
синтетических документов
обезличенных fixtures
```

Production-режим должен работать локально/on-prem через Ollama.

Debug/input/output/staging/golden-репорты могут содержать ПДн и должны оставаться локальными, не коммититься и не отправляться наружу.

---

## Useful commands

```bash
npm run check
npm run config:doctor
npm run dry-run
npm run extract
npm run ui
npm run test:golden
```
