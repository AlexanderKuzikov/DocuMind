# Linux + Ollama — развёртывание DocuMind (on-prem)

> Для офисного сервера заказчика. Cloud (RouterAI) — только для dev/тестов. Прод — локально, ПДн не уходит наружу.

## Железо и ОС

* Ubuntu 22.04/24.04 x64, 16 ГБ RAM+, RTX 5070 16GB (MoE `qwen3.6:35b-a3b` активно ~3B, 32k контекст ~10 т/с на 1660 6GB, на 5070 летает — `Ollama.md:49`)
* Node.js ≥22 ESM (`node -v`), `npm`, `git`

## 1. Ollama

```bash
curl -fsSL https://ollama.com/install.sh | sh
ollama --version
ollama pull qwen3.6:35b-a3b
ollama list
```

**Контекст 32k — критично** (`Ollama.md:15`, `BUG_REPORT C-2`). Ollama по умолчанию `num_ctx=2048` — молча выкидывает первые токены, модель галлюцинирует.

Вариант A — через API (рекомендован, уже в коде `src/lib/llm.js:198`):

```json
// DocuMind шлёт каждый запрос
{ "model": "qwen3.6:35b-a3b", "options": { "num_ctx": 32768 } }
```

Достаточно `config/config.jsonc:60` `prod-ollama.numCtx: 32768` — ничего на сервере не трогать.

Вариант B — дефолт на сервере через Modelfile:

```bash
cat > Modelfile <<'EOF'
FROM qwen3.6:35b-a3b
PARAMETER num_ctx 32768
EOF
ollama create qwen3.6-legal -f ./Modelfile
# далее в DocuMind: "model": "qwen3.6-legal"
```

VRAM: `32k` на `5070 16GB` ок для MoE. На dense `14B` было бы 15-16GB и OOM → `1-2 т/с` в RAM.

Проверка:

```bash
curl http://127.0.0.1:11434/api/tags
ollama run qwen3.6:35b-a3b "ping" --verbose
```

## 2. DocuMind

```bash
git clone https://github.com/AlexanderKuzikov/DocuMind.git
cd DocuMind
node -v  # >=22
npm install  # sharp, @napi-rs/canvas, pdfjs-dist — бинарники, сборки нет

cp .env.example .env
nano .env
```

`.env` для офиса:

```env
# Cloud — для тестов, прод не нужен
ROUTERAI_API_KEY=sk-...

# Office Ollama — приоритет у .env (src/lib/llm.js:104)
OLLAMA_BASE_URL=http://127.0.0.1:11434/v1
# или http://192.168.1.100:11434/v1 если Ollama на другой машине

# Переключение профиля без правки JSONC
DOCUMIND_ACTIVE_PROFILE=prod-ollama
```

Альтернатива — через UI: `npm run ui` → `Config` → `llm.profiles.prod-ollama.baseUrl`.

`config/config.jsonc`:

```jsonc
"llm": {
  "activeProfile": "prod-ollama", // или через DOCUMIND_ACTIVE_PROFILE
  "imagePolicy": "each-pass", // для two-pass
  "disableThinking": true, // reasoning:none
  "profiles": {
    "prod-ollama": {
      "baseUrl": "http://127.0.0.1:11434/v1",
      "baseUrlEnv": "OLLAMA_BASE_URL",
      "model": "qwen3.6:35b-a3b",
      "numCtx": 32768,
      "timeout": 300000
    }
  }
}
```

## 3. Запуск и проверка

```bash
npm run config:doctor  # 8 типов ok?
npm run dry-run        # промпт собирается?
npm run extract        # input/ → output/ + staging/ + config/debug/

# UI для визуального контроля
npm run ui             # http://127.0.0.1:4173 → Проверка (iframe PDF 62vh + JSON)
# для сети:
DOCUMIND_UI_HOST=0.0.0.0 DOCUMIND_UI_PORT=4173 npm run ui
```

`input/` — 1 PDF = 1 документ (топ-файл), папка = 1 документ со склейкой `assemble-document-pdf.js:195`, имена рандом `doc_*.pdf` — модель не подсматривает `one-pass.md:3`. `output/` — `Договор УПТ {contract_number} от {contract_date}.pdf/json` — плоский JSON `normalize-fields.js:133`, слэши `28/12/2023/УПТ-8` → `28 12 2023 УПТ-8` `write-output.js:14` Windows.

## 4. Промпты по типам

`config/prompts/templates/types/<type>.md` — один файл на тип, `prompt-builder.js:107` `types/<type>.md` → fallback `specific.md`. Добавить тип 140 = `config/doc_types/<new>.json` + `types/<new>.md`, `src/ui-server.js:171` рекурсивно видит `types/`.

## 5. Обрыв / падение модели

* `src/lib/llm.js:205` ретрай 3× `429`/`5xx`/`Abort` с паузой 2с×attempt, `response.json()` под таймаутом.
* `orchestrator.js:138` — ошибка одного документа `status:partial` + `config/debug/<docId>/` не валит батч.
* `config/debug/` + `staging/<docId>/manifest.json` — что было на входе.

## 6. Частые грабли

* `Missing API key env variable: ROUTERAI_API_KEY` при верном `.env` — смотри `getEnvValue` `src/lib/config.js:33`, нужен `node --env-file=.env` (в `package.json` уже).
* Порт `4173` занят — `ui-server.js` перебирает `4174-4183`.
* `qwen/qwen3.6-35b-a3b` на RouterAI требует `reasoning:{effort:"none"}` `src/lib/llm.js:181` (проверено 0 токенов vs 370) — для Ollama это `chat_template_kwargs:{enable_thinking:false}`.

## 7. Безопасность

`input/`/`output/`/`staging/`/`config/debug/`/`golden/` — могут содержать ПДн, в `.gitignore` (`staging/`/`debug/`/`output/`/`input/`), не коммитить. Прод — только `prod-ollama` локально, `mvp-routerai` — dev.
