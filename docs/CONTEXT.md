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
УПТ-блок 57 файлов + person-фикс / 12 файлов live ok / светлая тема
```

Прогон 24.08: 12 файлов live (3 акта + 4 УПТЮ + 3 УПТ + уведомление + unknown) — все `ok`, person-фикс `Гражданин РФ`/`РФ` → норма + дательный → именительный проверен ретраем `doc_025+027`; 57 рандом — 57/57 `ok` (one-pass) ранее. `qwen/qwen3.6-35b-a3b` RouterAI `reasoning:none` 0 tokens.

---

## Текущий активный режим

Активный режим (включён two-pass `config.jsonc:74`):

```text
input/ (57 рандом)
  → discover-documents
  → assemble-document-pdf (200 DPI JPEG)
  → build-universal-prompt (универсальный, типы + recognitionFeatures)
  → llm-universal-pass (тип)
  → build-specific-prompt (per-type types/<type>.md, fallback specific.md)
  → llm-specific-pass (поля типа)
  → normalize-fields (с нормализацией date/trim/uppercase)
  → write-output
  → output/<имя>.pdf + output/<имя>.json
```

One-pass остаётся в `prompt-builder.js:93` (`mode: one-pass` → `one-pass.md`). `rasterize-first-page` отключён.

---

## Что уже сделано

На текущем этапе в репозитории есть:

- Node.js 22 ESM, `package.json`, CLI `src/cli.js`, orchestrator `src/orchestrator.js`, компоненты `src/components/`;
- config-driven `config/config.jsonc` + `config/doc_types/*.json` (8 типов: 3 MVP + 5 УПТ) + `field_mappings.json`;
- prompt база `config/prompts/templates/` + per-type `types/<type>.md` 8 шт, `prompt-builder.js:107` per-type fallback;
- LLM `src/lib/llm.js` (`reasoning:none` 0 tokens, ретрай 3×, `num_ctx 32768`, `OLLAMA_BASE_URL` env-override `llm.js:104`);
- `assemble-document-pdf.js` 200 DPI JPEG, `rasterize-first-page` legacy;
- two-pass `universal` (тип) + `specific` (поля) + `one-pass` fallback, `normalize-fields.js:39` с `trim/date/uppercase` + `required` фикс;
- `write-output.js:14` `sanitizeFileNamePart` для Windows слэшей;
- `config:doctor`, `dry-run`, `prompt:render`, alias lookup, `golden/` 5 кейсов `test:golden`;
- `Ollama.md`, `LINUX_OLLAMA.md`, `BUG_REPORT`, `CODE_REVIEW 2026-08-23`;
- browser UI светлая тема `ui/style.css:1` `color-scheme: light`, табы `Config`/`Field Mappings`/`Pipeline`/`Doc Types`/`Prompts`/`Run`/`Files`/`Проверка` `ui/index.html:26`, `verify` `GET /api/verify/list` + `GET /api/raw/*` `ui-server.js:240` + `GET /api/files`, save guard + `types/` рекурсия.

---

## Активные типы документов

Сейчас зарегистрированы реальные типы (MVP + УПТ-блок 2026-08-23):

| Technical key | Название | Обязательные поля |
|---|---|---|
| `egrul_extract` | Выписка из ЕГРЮЛ | `ogrn`, `registration_record_date`, `short_name_ru` |
| `vehicle_registration_certificate` | Свидетельство о регистрации ТС | `vin`, `vehicle_number` |
| `traffic_accident_participants` | Сведения об участниках ДТП | `accident_location`, `accident_date` |
| `upt_rights` | Договор уступки прав (УПТ) | `contract_number`, `contract_date`, `debtor` |
| `upt_costs` | Договор уступки на судебные расходы (УПТЮ) | `contract_number`, `contract_date`, `debtor` |
| `upt_act` | Акт приёма-передачи по договору УПТ | `contract_number`, `contract_date` |
| `upt_notify` | Уведомление об уступке прав | `contract_number`, `contract_date` |
| `upt_add` | Дополнительное соглашение к УПТ | `addendum_date`, `contract_number`, `contract_date` |

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

### Договор уступки прав (УПТ) / УПТЮ

Поля:

```text
contract_number* (напр. 28/12/2023/УПТ-8, слэши в Windows станут пробелами)
contract_date* (дата договора)
debtor* (должник, обязательно)
cedent (цедент, желательно)
cessionary (цессионарий, желательно)
amount (цена цессии, желательно)
```

Имя файла:

```text
Договор УПТ {contract_number} от {contract_date}
Договор УПТЮ {contract_number} от {contract_date}
```

### Акт / Уведомление / Доп соглашение по УПТ

Поля:

```text
upt_act: contract_number, contract_date (ссылка на основной договор УПТ, из заголовка и фразы п.п. 3.3.2)
upt_notify: contract_number, contract_date (из текста п.3 ст.382 ГК и приложения (копия))
upt_add: addendum_date + contract_number/contract_date (ссылка на основной договор)
```

Имя файла:

```text
Акт приема-передачи документов по договору УПТ {contract_number} от {contract_date}
Уведомление о договоре УПТ {contract_number} от {contract_date}
Доп. Соглашение от {addendum_date} к договору УПТ {contract_number} от {contract_date}
```

Windows: слэши режет `sanitizeFileNamePart` `write-output.js:14`. Три акта заказчика объединены в один тип `upt_act` (aliases).

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
Ollama (numCtx: 32768 — см. Ollama.md)
qwen3.6:35b-a3b
```

Температура:

```text
0
```

Thinking — экспериментально, пока отключено.

### RouterAI / OpenRouter-совместимые провайдеры — важно

Для моделей с `disableThinking: true` (Qwen3 и аналоги) RouterAI.ru требует:

```json
{ "reasoning": { "effort": "none" } }
```

В `src/lib/llm.js:150` при `disableThinking: true` отправляется (проверено 2026-08-23 на `qwen/qwen3.6-35b-a3b`):

```js
body.reasoning = { effort: "none" };           // RouterAI канон (PDFtoText/converter.go)
body.reasoning_effort = "none";                // OpenRouter алиас
body.chat_template_kwargs = { enable_thinking: false }; // LM Studio / Ollama
body.thinking = { type: 'disabled', ... }      // Anthropic
```

Без `reasoning` — `370+ reasoning_tokens` и `0.04₽`, с ним — `0 tokens` и `0.0012₽` (×30 экономия).

### Офисный Ollama — быстрый переезд (2026-08-23)

IP сервера вводится одним из двух способов (без правки кода):

1) UI: `npm run ui` → Config → `llm.profiles.prod-ollama.baseUrl`
2) `.env`: `OLLAMA_BASE_URL=http://192.168.1.100:11434/v1` + `DOCUMIND_ACTIVE_PROFILE=prod-ollama` — приоритет у `.env` (`src/lib/llm.js:104`, `config/config.jsonc:59`)

MoE `qwen3.6:35b-a3b` активно ~3B — на GTX 1660 6GB ~10 т/с, на офисном RTX 5070 16GB `num_ctx 32768` летает (см. `Ollama.md`).

Если видишь ошибку `Missing API key env variable: ROUTERAI_API_KEY` при правильно прописанном ключе — смотри не `.env`, а функцию `getEnvValue` в `src/lib/llm.js`: она может читать переменные не из `process.env`.

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
- Б-3: 
ormalize-fields` исправлен.
- Б-4: `llm.js` нормально обрабатывает `content` как массив.
- Б-5: RouterAI — `ROUTERAI_API_KEY` не читался из `.env`; добавлен `reasoning_effort: "none"` для OpenRouter-провайдеров.
- В-1: prompt/text идёт перед image.
- В-4: output naming больше не зависит от `selectedDocType` в итоговом JSON.
- Выдуманные типы документов удалены.
- Активный pipeline переведён в one-pass режим.
- Добавлена сборка документа в единый PDF.
- Исправлены дробные Width/Height в PDF image XObject.
- Итоговый JSON очищен от debug/internal-полей.
- `docId` больше не строится из имени входящего файла.
- Добавлены реальные output naming templates.

### Fixed 2026-08-23

- Thinking Qwen: `reasoning: {effort:"none"}` `src/lib/llm.js:181` (проверено на `qwen/qwen3.6-35b-a3b` через RouterAI, 0 tokens vs 370) — `knowledge/routerai-api.md:44`.
- Ollama `num_ctx 32768` в `config.jsonc:67` + `llm.js:198` `options.num_ctx` + `OLLAMA_BASE_URL`/`DOCUMIND_ACTIVE_PROFILE` env-override `llm.js:104` для офиса; MoE 35B A3B на 5070 16GB ок (`Ollama.md:49`).
- УПТ-блок заказчика: 5 типов `upt_*` с 6+3 полями и `outputNaming` по ТЗ, `upt_act` унифицирован из 3 папок, слэши режет `sanitizeFileNamePart` `write-output.js:14`, `structure.txt` 10421/139 — тренировка.
- База промптов `types/<type>.md` 8 шт `prompt-builder.js:107` per-type fallback + `ui-server.js:171` рекурсия, `one-pass` + `two-pass` `config.jsonc:74` `pipeline 5-6`.
- LLM resilience: ретрай 3× `429`/`5xx`/`Abort` + `response.json()` под таймаутом `llm.js:205` (фикс `clearTimeout` leak `llm.js:244`), `baseUrl` валидация `new URL` `llm.js:104`.
- Нормализация: `normalize-fields.js:39` вызывалась, `required` фикс `normalize-fields.js:124`, `collectFields` depth>20.
- Светлая тема `ui/style.css:1` `color-scheme: light`, `Проверка` `verify` `GET /api/verify/list` + `GET /api/raw/*` `ui-server.js:240` N+1 фикс `Map`, `prompt-builder` `ENOENT` warn, `ui/app.js:320` dead branch, `body.options` spread.
- `golden/upt_*/` 5 кейсов, `input/` 57 рандом `doc_*.pdf` + `.mapping.json` анти-подгляд.

### Fixed 2026-08-24

- Person-поля `debtor/cedent/cessionary/recipient`: промпты `one-pass.md:35` + `types/upt_rights.md:14`/`upt_costs.md:14`/`upt_notify.md:14` + `config/doc_types/upt_*.json:57` требуют именительный без префиксов `Гражданин РФ/Гражданка РФ/РФ` (`Лузиной... -> Лузина...`, `Гражданин РФ Рябов... -> Рябов...`), код `src/components/normalize-fields.js:10` `normalizePersonName()` + `PERSON_FIELDS` + правило `person` — ретрай-прогон 2026-08-24 `doc_025+027` подтвердил `Лузина Екатерина Александровна` / `Рябов Александр Владимирович` `confidence 1`.
- Прогон 24.08 12 файлов: 3 акта + 4 УПТЮ + 3 УПТ + 1 уведомление + 1 unknown (доп 2022 честно), все `ok` `200 DPI` `qwen3.6:35b-a3b` RouterAI.

### Still open

- Нет полноценного golden set на реальных документах (нужны fixtures для УПТ).
- Ollama office server — проверить вживую `num_ctx 32768` на 5070 после `git pull` (IP через `.env`).
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

## Журнал работ (последние 20)

- 2026-08-24: Person-фикс УПТ — `Гражданин РФ` в `cessionary` (`РФ Рябов...` → `Рябов...` `doc_027`) и дательный должника (`Лузиной...` → `Лузина...` `doc_025`) — промпты `one-pass.md:35` + `types/upt_*.md:14` + `upt_*.json:57` `person` + код `normalize-fields.js:10` `normalizePersonName()` + `PERSON_FIELDS`; ретрай-прогон 2 файлов 2026-08-24 `ok` `confidence 1`, `12` файлов всего в `output/`.
- 2026-08-24: Живые прогоны 24.08 — 3 акта (27с) + 6 diverse (98с: 4 УПТЮ + уведомление + unknown) + 3 УПТ 05-08-2024 (68с) — все `ok` `qwen3.6:35b-a3b` RouterAI, `output/` 12 JSON переведено в `docs/CONTEXT.md`.
- 2026-08-23: УПТ-блок заказчика (02 Цессия) — 5 типов `upt_*` (ТЗ 6 полей + 3 доп `vehicle_number`/`accident_*`), унифицирован `upt_act` из 3 папок, `assembled` PDF, `sanitize` слэшей для Windows `write-output.js:14`. Вход `input/` 29 рандом `doc_*.pdf` + `.mapping.json` (анти-подгляд), `structure.txt` 10421/139 — тренировка, не истина.
- 2026-08-23: База промптов по типам `config/prompts/templates/types/<type>.md` 8 шт, `prompt-builder.js:107` per-type fallback, `ui-server.js:171` рекурсивный `types/`. Двухпроход оставлен `config.jsonc:72` one-pass для 8 типов, готов к 139 через `universal`+`specific`.
- 2026-08-23: LLM resilience — `reasoning: {effort:"none"}` `src/lib/llm.js:181` (RouterAI `qwen/qwen3.6-35b-a3b` 0 tokens vs 370, проверено), ретрай 3× `429`/`5xx`/`Abort` + `response.json()` под таймаутом `llm.js:205`, `OLLAMA_BASE_URL`/`DOCUMIND_ACTIVE_PROFILE` env-override `llm.js:104` для офиса 5070 16GB MoE `Ollama.md:49`.
- 2026-08-23: Визуальный контроль `ui` таб `Проверка` `ui/index.html:26` — `GET /api/verify/list` + `GET /api/raw/input|output` `ui-server.js:240`, split `iframe` PDF `62vh` + JSON таблица `verify-table` `style.css:360`. `normalize-fields.js:124` фикс `required` (было `partial` на optional).
- 2026-08-23: Прогон 1 на 29 рандом — 28 `ok` + 1 `unknown` (доп 2022 без УПТ, честно), `golden/upt_*/` 5 кейсов для регресса, `knowledge/routerai-api.md:44` баланс `/credits` (RouterAI 79₽, OpenRouter 10.75$).

## Useful commands

```bash
npm run check
npm run config:doctor
npm run dry-run
npm run extract
npm run ui          # http://127.0.0.1:4173 → Проверка
npm run test:golden
```

См. также [`docs/LINUX_OLLAMA.md`](LINUX_OLLAMA.md) — развёртывание на Linux + Ollama on-prem.
