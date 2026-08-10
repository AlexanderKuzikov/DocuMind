# DocuMind — Instructions for AI Agents

## Commands
- extract: `npm run extract`
- dry-run: `npm run dry-run`
- config:doctor: `npm run config:doctor`
- prompt:render: `npm run prompt:render`
- test:golden: `npm run test:golden`
- ui: `npm run ui`
- check: `npm run check`

## Conventions
- Node.js ESM, vanilla JS (без TypeScript)
- Sharp, pdfjs-dist, @napi-rs/canvas
- VLM: LM Studio / Ollama / RouterAI (OpenAI-compatible)
- Config-driven (JSONC конфиги)
- Pipeline: discover → assemble PDF → build prompt → LLM → normalize → output
- Node >=22

## Structure
- `src/` — pipeline stages
- `configs/` — JSONC конфиги типов документов
- `prompts/` — шаблоны промптов
- `ui/` — локальный браузерный UI

## Do NOT touch
- `.env` — секреты
- `node_modules/`

## Documentation rules
- После работы — обнови docs/CONTEXT.md
- Если принял архитектурное решение — запиши в docs/DECISIONS.md
- НЕ создавай новых файлов документации без разрешения
