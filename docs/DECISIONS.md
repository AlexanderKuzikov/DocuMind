# DocuMind — DECISIONS

<!-- Append-only. Формат фиксирован. -->

## 2026-06-15: Config-driven pipeline

**Контекст:** Разные типы документов (ЕГРЮЛ, СТС, ДТП) требуют разных промптов и нормализации.

**Решение:** JSONC-конфиг на тип документа: discovery rules, prompt template, normalization schema.

**Альтернативы:** Hardcode на каждый тип, плагины.

**Trade-off:** Конфиги нужно поддерживать, но добавление типа = новый файл, не код.

## 2026-06-15: Local VLM (LM Studio / Ollama)

**Контекст:** Документы содержат персональные данные, отправка в облако недопустима.

**Решение:** OpenAI-compatible API на локальной машине.

**Альтернативы:** Cloud API (GPT-4V, Gemini), on-premise server.

**Trade-off:** Качество ниже cloud, но privacy и zero-cost.

## 2026-08-23: UPT document types consolidation

**Контекст:** Заказчик прислал ТЗ на цессию: 2 договора (УПТ/УПТЮ) + акт (объединяет 3 папки) + уведомление + доп соглашение. Исходная разбивка 7 папок ошибочно дублировала акты. Нужна 1-PDF=1-документ (Windows), слэши в номере `28/12/2023/УПТ-8`.

**Решение:** 5 типов: `upt_rights` (УПТ), `upt_costs` (УПТЮ) с 6 полями (`contract_number*`, `contract_date*`, `debtor*`, `cedent`, `cessionary`, `amount`), `upt_act` (унифицирован, aliases 7), `upt_notify` (УПТ/УПТЮ), `upt_add` (`addendum_date`+`contract_number`/`contract_date`). Шаблоны `outputNaming` строго по ТЗ, слэши режет `sanitizeFileNamePart` `write-output.js:14` в пробелы (Windows). Старые `upt_doc_act`/`upt_act_short` удалены, `prompt-builder` автоматом подхватит.

**Альтернативы:** Оставить 7 типов — модель путалась бы в 3 одинаковых актах.

**Trade-off:** Уведомление/доп для УПТЮ пока через один тип (contract_number содержит УПТЮ) — если заказчик потребует строго `УПТЮ` в префиксе, разведём на 2 типа без правки кода.

## 2026-08-23: LLM resilience (обрыв/падение модели)

**Контекст:** Тесты в облаке (`qwen/qwen3.6-35b-a3b` через RouterAI) и будущий офис Ollama на RTX 5070 16GB (MoE 35B A3B ~10 т/с на 1660 6GB, `num_ctx 32768` в `config.jsonc:67` + `llm.js:198` `options.num_ctx`). Падение модели/обрыв сети ломало весь прогон, таймаут не покрывал `response.json()` (`BUG_REPORT П-1`), нет ретраев.

**Решение:** `src/lib/llm.js:205` ретрай 3× с паузой 2с×attempt для `429`/`5xx`/`AbortError`/`ECONNRESET`, таймаут `profile.timeout||180s` покрывает `fetch`+`response.json()` через `Promise.race`, `body` сериализуется один раз. `orchestrator.js:138` уже изолирует документы: ошибка одного → `status:partial/error` + `debug/<docId>/` + продолжение батча, не краш. `OLLAMA_BASE_URL`/`DOCUMIND_ACTIVE_PROFILE` в `.env` (`llm.js:104`) позволяют сменить IP офиса без правки JSONC. `config:doctor`/`dry-run` перед прогоном ловят конфиг-ошибки.

**Альтернативы:** Очередь с паузой между документами, внешний supervisor.

**Trade-off:** Ретрай ×3 увеличивает время прогона при деградации, но дешевле чем ручной перезапуск 29 файлов.
