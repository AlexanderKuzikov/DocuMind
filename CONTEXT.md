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
MVP foundation / demo-ready
```

Это уже рабочая основа, но ещё не production-complete система.

## Что уже сделано

На текущем этапе в репозитории есть:

- Node.js проект с `package.json` и `package-lock.json`;
- CLI entrypoint `src/cli.js`;
- orchestrator `src/orchestrator.js`;
- компонентная архитектура в `src/components/`;
- config-driven pipeline через `config/config.jsonc`;
- типы документов в `config/doc_types/*.json`;
- prompt templates в `config/prompts/templates/*.md`;
- LLM client в `src/lib/llm.js`;
- rasterization первой страницы PDF/изображения;
- universal pass;
- wide legal extraction second pass;
- session-based image policy;
- базовая нормализация;
- output writer;
- debug artifacts;
- `config:doctor`;
- `dry-run`;
- golden runner;
- README, CONTEXT, docs/ARCHITECTURE, docs/PROMPTS, docs/GOLDEN_SET;
- локальный browser UI через `npm run ui`.

Текущий pipeline:

```text
discover-documents
  ↓
rasterize-first-page
  ↓
build-universal-prompt
  ↓
llm-universal-pass
  ↓
build-specific-prompt
  ↓
llm-specific-pass
  ↓
normalize-fields
  ↓
write-output
```

## Что планируем делать

Ближайшие цели:

1. Довести MVP до demo-ready состояния.
2. Добавить реальные golden set fixtures.
3. Улучшить нормализацию:
   - ФИО;
   - адреса;
   - даты;
   - суммы;
   - реквизиты;
   - номера документов;
   - VIN;
   - ОСАГО;
   - водительские удостоверения.
4. Улучшить human-readable error reporting.
5. Проверить session behavior на RouterAI/LM Studio/Ollama.
6. Уточнить CRM mapping по реальным документам.
7. Добавить больше doc types через `config/doc_types/*.json`.
8. Добавить CI/quality gates.

## Ключевые договоренности

### 1. Компоненты — отдельными файлами

Это принципиально.

Каждый компонент лежит в:

```text
src/components/
```

Компоненты не должны напрямую импортировать друг друга. Они работают через общий `context`.

Оркестратор знает порядок pipeline.

### 1.1. Required

`required: true` означает: если компонент упал, pipeline останавливается на этом документе.

`required: false` означает: ошибка компонента сохраняется в результат, но pipeline продолжает следующие шаги.

Это нужно для экспериментальных/опциональных компонентов:

```text
rotate-image
quality-check
llm-normalize
```

Они могут быть выключены или optional, чтобы быстро проверять гипотезы без поломки всего pipeline.

### 2. `concurrency: 1`

Это жёсткое архитектурное правило.

Обработка документов строго последовательная:

```js
for (const doc of documents) {
  await processDocument(doc);
}
```

Не использовать `Promise.all()` для документов или LLM-запросов.

### 3. Типы документов не хардкодятся в коде

Новый тип документа добавляется одним файлом:

```text
config/doc_types/<type>.json
```

Код менять не нужно.

### 4. JSON стремится к строгости

JSON-схемы и тяжёлые валидаторы пока не добавляем.

Пока достаточно:

- аккуратной структуры;
- `config:doctor`;
- минимального runtime-check;
- будущей LLM-валидации новых типов.

### 5. Промпты динамические

Не замораживаем prompt text в коде.

Промпты собираются из:

```text
config/config.jsonc
config/doc_types/*.json
config/prompts/templates/*.md
```

Но для каждого запуска сохраняем rendered prompts в debug artifacts.

### 6. Изображение отправляется один раз

Текущая договоренность:

```text
Pass 1: image + universal prompt
Pass 2: previous result + wide legal extraction prompt
```

Второй запрос идёт в той же LLM-сессии без повторной отправки картинки.

Конфиг:

```json
{
  "llm": {
    "imagePolicy": "session",
    "sessionFallback": "each-pass"
  }
}
```

Если провайдер не держит session, fallback — `each-pass`.

### 7. Второй проход — широкий legal extraction

Второй prompt не должен быть узким schema-only запросом.

Цель второго прохода:

```text
Извлеки все данные, которые могут быть использованы в юридическом рассмотрении этого документа.
Выведи в виде JSON. Больше ничего не пиши.
```

Потом `normalize-fields` приводит результат к CRM/legal-схеме.

### 8. Unknown docType — нормальный сценарий

Если первый проход не определил тип:

```text
unknown
```

не останавливаемся.

Запускаем generic legal extraction и сохраняем output со статусом `unknown` или `partial`.

### 9. LLM не должна додумывать

В prompt и нормализации важно правило:

```text
Не выдумывай отсутствующие значения.
Если значение не найдено или сомнительно — null.
```

### 10. Ошибки должны быть честными

Пользователь должен видеть:

```text
что произошло;
на каком этапе;
насколько это критично;
вероятные причины;
что можно сделать дальше.
```

Raw stack trace — только в debug/log.

### 11. Production data policy

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

## Конфигурация

Основной конфиг:

```text
config/config.jsonc
```

Это JSONC, поэтому комментарии разрешены.

Секреты в конфиг не кладём.

Ключи берём из env:

```env
ROUTERAI_API_KEY=
LOCAL_LLM_API_KEY=
INTERNAL_LLM_API_KEY=
```

## LLM profiles

Текущий активный профиль для экспериментов:

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
  "timeout": 300000
}
```

LM Studio в OpenAI-compatible режиме не требует API key.

Если LM Studio отдаёт другое имя модели, его надо поменять в `config/config.jsonc` в поле `llm.profiles["local-lmstudio"].model`.

RouterAI:

```text
mvp-routerai
local-lmstudio
prod-ollama
```

MVP:

```text
RouterAI.ru
qwen/qwen3.6-35b-a3b
```

Production target:

```text
Linux
Ollama
qwen3.6:35b-a3b
```

Температура:

```text
0
```

Thinking — экспериментально, пока отключено.

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

Источник истины для UI — `config/config.jsonc`. UI не должен иметь отдельный хардкодный список компонентов.

## DPI

Текущий MVP DPI:

```text
200
```

150/300 и разные DPI по типам документов — позже.

## Output

Финальный output должен быть JSON в `output/`.

Ожидаемая структура:

```json
{
  "docId": "...",
  "docType": "...",
  "docTypeName": "...",
  "status": "ok | partial | failed | unknown",
  "source": {},
  "firstPass": {},
  "rawExtracted": {},
  "fields": {},
  "normalizedFields": {},
  "validation": {},
  "crm": {},
  "createdAt": "..."
}
```

## Debug

Debug artifacts сохраняются в:

```text
debug/<docId>/
```

Содержимое:

```text
universal.prompt.md
universal.response.json
specific.prompt.md
specific.response.json
output.json
```

Debug можно отключать через `config/config.jsonc`.

## Golden set

Golden set — отдельный тестовый слой.

Структура:

```text
golden/
  passport/
    passport-001/
      input/
        document.pdf
      expected.json
      config.json
```

Цель:

```text
проверять, не деградировал ли результат после изменений prompt/config/model.
```

Сейчас golden runner есть, но fixtures ещё нужно добавить.

## Команды

```bash
npm install
npm run check
npm run config:doctor
npm run dry-run
npm run extract
npm run prompt:render -- --doc-type passport
npm run test:golden
```

## Что не обещаем на текущей стадии

Не обещаем:

- 100% точность;
- production-complete систему;
- поддержку всех типов документов;
- полноценный production UI;
- полноценный CRM mapping;
- enterprise-grade CI/CD;
- обработку всех edge cases.

## Стиль работы

- Минимальный scope.
- Сначала MVP, потом усложнения.
- Не уходить в overengineering.
- Честно фиксировать ограничения.
- Не хардкодить секреты.
- Не сохранять API keys в конфиге.
- Не менять архитектурные договоренности без причины.

## Дневник разработки

### 2026-06-17 — MVP foundation

Создан базовый Node.js проект:

- `package.json`;
- `package-lock.json`;
- `src/cli.js`;
- `src/orchestrator.js`;
- `src/components/`;
- `src/lib/`;
- `config/config.jsonc`;
- `config/doc_types/*.json`;
- `config/prompts/templates/*.md`;
- `src/test/golden-runner.js`;
- `README.md`;
- `CONTEXT.md`;
- `docs/ARCHITECTURE.md`;
- `docs/PROMPTS.md`;
- `docs/GOLDEN_SET.md`.

Добавлен минимальный pipeline:

```text
discover-documents
rasterize-first-page
build-universal-prompt
llm-universal-pass
build-specific-prompt
llm-specific-pass
normalize-fields
write-output
```

Commit:

```text
456c0b4 — Add DocuMind MVP orchestrator and project scaffolding
```

### 2026-06-17 — CONTEXT как onboarding для LLM

`CONTEXT.md` переписан как файл быстрого погружения новой LLM/агента в проект.

Добавлены:

- цель проекта;
- что уже сделано;
- что планируем делать;
- ключевые архитектурные договоренности;
- `concurrency: 1`;
- component-based pipeline;
- dynamic prompts;
- session-based image policy;
- free legal extraction second pass;
- unknown docType handling;
- data policy для ПДн;
- config/profiles;
- output/debug/golden set;
- ограничения текущей стадии.

Commit:

```text
3695292 — Improve README badges and CONTEXT onboarding
```

### 2026-06-17 — Local browser config UI

Добавлен локальный browser UI:

- `src/ui-server.js`;
- `ui/index.html`;
- `ui/app.js`;
- `ui/style.css`;
- `npm run ui`.

UI стартует на:

```text
http://127.0.0.1:4173
```

Порт `3000` специально не используется. Если `4173` занят, сервер перебирает `4174–4183`.

UI умеет:

- редактировать `config/config.jsonc`;
- редактировать `config/doc_types/*.json`;
- редактировать prompt templates;
- сканировать `src/components/*.js`;
- читать `meta` компонентов;
- включать/выключать компоненты;
- менять `required`;
- менять порядок pipeline;
- удалять компонент из pipeline;
- добавлять новые компоненты, если они экспортируют `meta`;
- запускать `config:doctor`, `dry-run`, `render prompt`, `extract`;
- смотреть файлы из `output/` и `debug/`.

`required` зафиксирован как:

```text
если компонент упал, pipeline останавливается
```

`required: false` означает:

```text
ошибка сохраняется в результат, но pipeline продолжает следующие шаги
```

Commit:

```text
0999f19 — Add local browser config UI
```

### 2026-06-17 — UI styling pass

Обновлен `ui/style.css` и исправлен относительный путь к CSS в `ui/index.html`.

Визуальный стиль UI:

- dark dashboard theme;
- аккуратный header;
- sticky tabs;
- pill buttons;
- карточки компонентов;
- better focus/hover states;
- responsive layout;
- subtle grid background;
- `prefers-reduced-motion` support.

Для локального открытия файла исправлено:

```text
/style.css → style.css
```

Чтобы CSS не ломался при `file://`.

### 2026-06-17 — UI hints and instructions

В UI добавлены подсказки на каждой вкладке:

- Config — что редактируется и когда запускать Config Doctor;
- Pipeline — чем отличаются `enabled` и `required`;
- Doc Types — как добавлять типы документов;
- Prompts — как собираются templates + doc type;
- Run — что безопасен Dry Run и активен local-lmstudio без API key;
- Files — предупреждение, что output/debug могут содержать ПДн.

Также исправлен относительный путь к `app.js`:

```text
/app.js → app.js
```

### 2026-06-17 — UI static path fix

Исправлен баг на Windows/MSYS при запуске UI через `npm run ui`.

Причина:

```text
safeJoin(resolveFromProject('ui'), url.pathname)
```

передавал в `path.resolve()` путь вида `/style.css`, и Windows мог интерпретировать его как путь от корня диска, а не относительно папки `ui/`.

Исправление:

```text
relativePath.replace(/^[/\\]+/, '')
```

Теперь `/style.css` и `/app.js` корректно обслуживаются относительно `ui/`.

### 2026-06-17 — UI module script fix

`ui/app.js` использует top-level `await`.

В обычном `<script src="app.js"></script>` браузер выполняет файл как classic script, и top-level `await` не должен использоваться. Из-за этого UI мог показывать статичную страницу и оставаться на `loading…`.

Исправлено подключение:

```html
<script type="module" src="app.js"></script>
```

### 2026-06-17 — LM Studio local profile

В `config/config.jsonc` установлен активный профиль:

```text
local-lmstudio
```

Настройки:

```text
baseUrl: http://127.0.0.1:1234/v1
model: qwen3.6:35b-a3b
apiKeyEnv: null
```

`LOCAL_LLM_API_KEY` убран из `.env.example`, потому что LM Studio OpenAI-compatible server не требует API key.

### 2026-06-17 — Production data policy

Зафиксировано правило:

```text
реальные юридические документы с персональными данными не отправляются во внешние LLM-сервисы
```

Cloud-профили, включая RouterAI, разрешены только для:

```text
dev
sandbox
синтетических документов
обезличенных fixtures
```

Production-режим должен работать локально/on-prem через Ollama.

### Текущий open next step

Следующий полезный шаг:

```text
взять 3 вида документов по 6–10 примеров
создать первые golden fixtures
прогнать pipeline
уточнить prompts/doc_types/normalization
```
