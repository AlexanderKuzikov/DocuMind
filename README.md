# DocuMind

[![License](https://img.shields.io/github/license/AlexanderKuzikov/DocuMind)](https://github.com/AlexanderKuzikov/DocuMind/blob/main/LICENSE)
[![GitHub last commit](https://img.shields.io/github/last-commit/AlexanderKuzikov/DocuMind)](https://github.com/AlexanderKuzikov/DocuMind/commits/main)
[![GitHub repo size](https://img.shields.io/github/repo-size/AlexanderKuzikov/DocuMind)](https://github.com/AlexanderKuzikov/DocuMind)
[![Node.js >=22](https://img.shields.io/badge/Node.js-%3E%3D22-blue)](https://nodejs.org/)
[![Pipeline](https://img.shields.io/badge/pipeline-concurrency%3A1-green)](https://github.com/AlexanderKuzikov/DocuMind)
[![LLM](https://img.shields.io/badge/LLM-LM%20Studio%20%2F%20RouterAI%20%2F%20Ollama-purple)](https://github.com/AlexanderKuzikov/DocuMind)

DocuMind — Node.js orchestrator для config-driven извлечения юридически значимых данных из документов.

## Текущий MVP

Текущий активный режим — **one-pass extraction + сборка документа в единый PDF**.

Приложение:

1. читает документы из `input/`;
2. группирует документы:
   - top-level файл = один документ;
   - top-level папка = один документ;
3. игнорирует мусор в имени входящего файла;
4. определяет тип документа только по содержанию;
5. растрирует/собирает документ в единый PDF;
6. за один LLM-проход извлекает 2–3 обязательных поля;
7. сохраняет PDF и JSON в `output/`.

Активный pipeline:

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

Старые компоненты двухпроходного pipeline не удалены. Они оставлены в `src/components/` для дальнейшего развития, но в `config/config.jsonc` сейчас отключены.

## Поддерживаемые типы документов

Сейчас в MVP зарегистрированы только реальные типы:

| Technical key | Название | Обязательные поля |
|---|---|---|
| `egrul_extract` | Выписка из ЕГРЮЛ | `ogrn`, `registration_record_date`, `short_name_ru` |
| `vehicle_registration_certificate` | Свидетельство о регистрации ТС | `vin`, `vehicle_number` |
| `traffic_accident_participants` | Сведения об участниках ДТП | `accident_location`, `accident_date` |

Входящие имена файлов не используются для определения типа документа и не используются для именования результата.

## Именование выходных файлов

Выходные файлы формируются по шаблонам из `config/doc_types/*.json`.

### Выписка из ЕГРЮЛ

```text
Выписка из ЕГРЮЛ {short_name_ru} от {registration_record_date}.pdf
Выписка из ЕГРЮЛ {short_name_ru} от {registration_record_date}.json
```

Важно: для `registration_record_date` используется дата внесения записи в ЕГРЮЛ, а не дата выписки.

### СТС

```text
СТС {vehicle_number}.pdf
СТС {vehicle_number}.json
```

### Сведения об участниках ДТП

```text
Сведения об участниках ДТП {accident_date}.pdf
Сведения об участниках ДТП {accident_date}.json
```

Для ДТП поле `accident_location` имеет label `Место ДТП`, потому что это может быть не только адрес, но и трасса, участок дороги или иной ориентир.

## JSON output

Каждый JSON — плоский, без debug/internal-полей.

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

`docId` имеет формат:

```text
dm-YYYYMMDDHHMMSS-<content-hash>-<run-suffix>
```

Он не строится из имени входящего файла. Hash считается по содержимому файлов документа, а `run-suffix` делает ID уникальным даже при повторной обработке одного и того же документа.

## Статус

```text
MVP foundation / demo-ready, не production-complete
```

Пройдены базовые проверки:

```bash
npm run check
npm run config:doctor
npm run dry-run
npm run extract
```

Остаются:

- полноценный golden set на реальных документах;
- проверка RouterAI;
- проверка офисного Ollama-сервера в локальной сети;
- расширение нормализации под юридически полный набор полей;
- CI/quality gates.

## Принципы

- Node.js, Windows 10/11 и Linux.
- Управление через конфиг.
- Типы документов описываются в `config/doc_types/*.json`.
- Поля и русские labels описываются в `config/doc_types/*.json`.
- Понятный маппинг технических ключей хранится в `config/field_mappings.json`.
- Промпты собираются автоматически из шаблонов и конфигов типов.
- Обработка строго последовательная: `concurrency: 1`.
- Один активный документ и один активный LLM-запрос за раз.
- Компоненты вынесены в отдельные файлы и подключаются через оркестратор.
- Production-документы с персональными данными не отправляем во внешние LLM-сервисы.

## Быстрый старт

```bash
npm install
npm run config:doctor
npm run dry-run
```

Положите документы в `input/` и запустите:

```bash
npm run extract
```

Результаты будут в `output/`, отладочные артефакты — в `debug/`.

## Конфигурация

Основной конфиг:

```text
config/config.jsonc
```

Это JSONC, поэтому в нём разрешены комментарии. Секреты в конфиг не кладутся.

Текущий активный профиль для быстрых тестов:

```text
local-lmstudio
baseUrl: http://127.0.0.1:1234/v1
model: qwen3.6:35b-a3b
apiKeyEnv: null
imageEncoding: base64-prefixed
lmStudioCompat: true
```

Профили:

```text
mvp-routerai      — RouterAI.ru, dev/sandbox
local-lmstudio    — локальные быстрые тесты
prod-ollama       — целевой on-prem/Ollama-профиль
```

Добавление нового типа документа:

```text
config/doc_types/<type>.json
```

Файл типа содержит:

- `type`;
- `name`;
- `aliases`;
- `recognitionFeatures`;
- `fields`;
- `validationRules`;
- `outputNaming`.

Код менять не нужно.

## Команды

```bash
npm run extract
npm run dry-run
npm run config:doctor
npm run test:golden
npm run check
npm run ui
```

## Local config UI

Запуск локального интерфейса:

```bash
npm run ui
```

Интерфейс открывается только на localhost:

```text
http://127.0.0.1:4173
```

Порт `3000` специально не используется. При старте сервер проверяет `4173`, а если он занят — перебирает `4174–4183`.

UI умеет:

- редактировать `config/config.jsonc`;
- редактировать `config/doc_types/*.json`;
- редактировать `config/field_mappings.json`;
- редактировать prompt templates;
- читать доступные компоненты из `src/components/`;
- включать/выключать компоненты в `config.pipeline`;
- менять `required`;
- менять порядок шагов;
- добавлять новые компоненты, если они экспортируют `meta`;
- запускать `config:doctor`, `dry-run`, `render prompt`, `extract`;
- смотреть файлы из `output/` и `debug/`.

Перед сохранением конфигов UI делает backup, JSON/JSONC parse, `config:doctor` и prompt preview. Запуск pipeline через UI защищён lock-ом, чтобы не было параллельных документов или LLM-запросов.

## Архитектура

См. `docs/ARCHITECTURE.md`.

## Prompting

См. `docs/PROMPTS.md`.

## Golden set

См. `docs/GOLDEN_SET.md`.

## Bug report

См. `BUG_REPORT.md`.

## License

Apache-2.0.
