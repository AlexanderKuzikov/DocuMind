<p align="center">
  <a href="https://nodejs.org/"><img alt="Node 22" src="https://img.shields.io/badge/Node-22+-339933?logo=node.js&logoColor=white"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/License-Apache_2.0-blue.svg"></a>
</p>

<h1 align="center">DocuMind</h1>
<p align="center">Config-driven извлечение данных из сканированных документов через VLM</p>

---

Извлекает юридически значимые данные из сканов (выписки ЕГРЮЛ, СТС, протоколы ДТП) через локальную VLM. Pipeline: discover → assemble PDF → build prompt → LLM → normalize → output. Config-driven: новый тип документа = новый JSONC-конфиг.

- **Config-driven** — JSONC на тип документа (discovery, prompt, normalization)
- **Local VLM** — LM Studio / Ollama / RouterAI (OpenAI-compatible)
- **Pipeline** — discover → assemble → prompt → LLM → normalize → output
- **Browser UI** — локальный интерфейс для управления
- **Golden tests** — верификация на эталонных документах
- **Privacy** — данные не покидают локальную машину

## Быстрый старт

```bash
git clone https://github.com/AlexanderKuzikov/DocuMind.git
cd DocuMind
npm install
cp .env.example .env   # VLM endpoint

npm run config:doctor  # проверка конфигов
npm run dry-run        # без вызова LLM
npm run extract        # полный pipeline
npm run ui             # браузерный интерфейс
```

## Документация

- [`docs/CONTEXT.md`](docs/CONTEXT.md) — состояние проекта
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — архитектурные решения

## Статус

**Работает** — ЕГРЮЛ, СТС, ДТП. Config-driven, golden tests.

## Лицензия

[Apache-2.0](LICENSE) © Alexander Kuzikov
