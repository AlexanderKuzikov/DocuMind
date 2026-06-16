# DocuMind

[![License](https://img.shields.io/github/license/AlexanderKuzikov/DocuMind)](https://github.com/AlexanderKuzikov/DocuMind/blob/main/LICENSE)
[![GitHub last commit](https://img.shields.io/github/last-commit/AlexanderKuzikov/DocuMind)](https://github.com/AlexanderKuzikov/DocuMind/commits/main)
[![GitHub repo size](https://img.shields.io/github/repo-size/AlexanderKuzikov/DocuMind)](https://github.com/AlexanderKuzikov/DocuMind)
[![Node.js >=22](https://img.shields.io/badge/Node.js-%3E%3D22-blue)](https://nodejs.org/)
[![Pipeline](https://img.shields.io/badge/pipeline-concurrency%3A1-green)](https://github.com/AlexanderKuzikov/DocuMind)
[![LLM](https://img.shields.io/badge/LLM-RouterAI%20%2F%20Ollama-purple)](https://github.com/AlexanderKuzikov/DocuMind)

DocuMind — Node.js orchestrator для config-driven извлечения данных из документов.

Текущая цель проекта — минимальный законченный workflow:

```text
input folder
  → первая страница документа
  → raster 200 dpi
  → маленький universal prompt
  → определение типа документа + 2-3 опорных поля
  → широкий legal extraction prompt в той же LLM-сессии
  → извлечение всех юридически значимых данных
  → нормализация
  → CRM/legal-ready JSON
```

## Статус

```text
MVP foundation / demo-ready, не production-complete
```

Текущая версия уже умеет собрать pipeline, прогнать документ через LLM и записать JSON, но ещё требует реальных golden set-тестов, доводки нормализации и проверки на документах пользователя.

## Принципы

- Node.js, работает на Windows 10/11 и Linux.
- Управление через конфиг.
- Типы документов описываются в `config/doc_types/*.json`.
- Промпты собираются автоматически из шаблонов и конфигов типов.
- Обработка строго последовательная: `concurrency: 1`.
- Компоненты вынесены в отдельные файлы и подключаются через оркестратор.
- RouterAI используется для MVP, Ollama/Linux — production target.

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

Пример переменных:

```env
ROUTERAI_API_KEY=
LOCAL_LLM_API_KEY=
INTERNAL_LLM_API_KEY=
```

Типы документов добавляются одним файлом:

```text
config/doc_types/passport.json
config/doc_types/invoice.json
config/doc_types/marriage_certificate.json
config/doc_types/traffic_accident_appendix.json
```

Файл типа содержит:

- `type`;
- `name`;
- `aliases`;
- `recognitionFeatures`;
- `firstPassFields`;
- `secondPass.mode`;
- `targetSchema`;
- `crmNaming`.

Код менять не нужно.

## Команды

```bash
npm run extract
npm run dry-run
npm run config:doctor
npm run prompt:render -- --doc-type passport
npm run test:golden
npm run check
```

## Архитектура

См. `docs/ARCHITECTURE.md`.

## Prompting

См. `docs/PROMPTS.md`.

## Golden set

См. `docs/GOLDEN_SET.md`.

## Лицензия

Apache-2.0.
