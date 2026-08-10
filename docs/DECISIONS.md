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
