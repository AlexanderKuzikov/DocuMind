# HANDOFF — DocuMind

> Создан: 2026-08-23 18:50
> Причина: переключение сессии (контекст 57 файлов УПТ, 8 типов, two-pass + verify + light тема), фиксация для новой сессии

## Текущая задача

DocuMind two-pass demo-ready на 8 типах (3 MVP + 5 УПТ). 57 рандом `input/doc_*.pdf` прогнаны `one-pass` 57/57 `ok` и `two-pass` 29/29 `ok` (RouterAI `qwen/qwen3.6-35b-a3b` `reasoning:none`). Светлая `Проверка` готова для заказчика. Готовим `git pull` в офисе на Linux + Ollama `5070 16GB`.

## Что сделано в этой сессии

- `qwen/qwen3.6-35b-a3b` RouterAI: `reasoning:{effort:"none"}` `src/lib/llm.js:181` 0 tokens vs 370, `reasoning_effort` алиас, `chat_template_kwargs` для Ollama, `num_ctx 32768` `llm.js:198`, `OLLAMA_BASE_URL`/`DOCUMIND_ACTIVE_PROFILE` env-override `llm.js:104`
- Баланс: RouterAI `GET /api/v1/credits` 79₽, OpenRouter 10.75$ `knowledge/routerai-api.md:44`
- УПТ-блок 02 Цессия 1223/7 → 5 типов `upt_rights`/`upt_costs`/`upt_act` (унифицирован из 3 папок)/`upt_notify`/`upt_add` с 6+3 полями `vehicle_number`/`accident_*`, `sanitize` слэшей `write-output.js:14`, `structure.txt` 10421/139 — тренировка
- База промптов `config/prompts/templates/types/<type>.md` 8 шт, `prompt-builder.js:107` per-type fallback, `ui-server.js:171` рекурсия
- `input/` 29→57 рандом `doc_*.pdf` + `.mapping.json` анти-подгляд `one-pass.md:3`, `golden/upt_*/` 5 кейсов
- `Проверка` `ui/index.html:26` `verify` — `GET /api/verify/list` + `GET /api/raw/*` `ui-server.js:240` `iframe 62vh` + таблица `style.css:360`
- `Ollama.md:49` MoE 35B A3B 10т/с на 1660 6GB, 5070 ок, `docs/LINUX_OLLAMA.md` для Linux on-prem
- Светлая тема `ui/style.css:1` `color-scheme: light` для заказчика
- Code review 2026-08-23: `normalize-fields.js:39` нормализация + `required` фикс, `llm.js:244` `clearTimeout` leak + `new URL` валидация, `ui-server.js:191` N+1 `Map`, `prompt-builder` `ENOENT` warn, `ui/app.js:320` dead branch, `body.options` spread — `main 912838a`

## Что осталось сделать

- [ ] Проверить `Проверка` в браузере на 57 файлах (сравнить `contract_number` с PDF)
- [ ] Заполнить `golden/upt_*/expected.json` контрактами из прогона 57 для регресса (`npm run test:golden` — сейчас runner `input` игнорит, надо починить)
- [ ] `git pull` в офисе (Linux) — `OLLAMA_BASE_URL=http://192.168.1.100:11434/v1` в `.env`, `ollama pull qwen3.6:35b-a3b`, `npm run config:doctor` + `npm run extract` на 57
- [ ] Поправить `upt_add` для доп 2022 без `УПТ` (сейчас `unknown` честно, но можно добавить fallback)
- [ ] Добавить `output/` в `.gitignore` уже, `input/` игнор, не коммитить ПДн

## Ключевые файлы

- `config/config.jsonc:74` — `mode: two-pass` + `pipeline 5-6` `buildSpecificPrompt`/`llmSpecificPass` (сейчас `one-pass` для 57, `two-pass` для 29 тестили)
- `src/lib/llm.js:104,181,205` — `getActiveProfile` env-override + `reasoning` + ретрай 3× + `num_ctx`
- `src/components/normalize-fields.js:39,124` — нормализация + `required` фикс
- `src/prompt-builder.js:107` — per-type `types/<type>.md`
- `src/ui-server.js:171,191,240` — `types` рекурсия, `verify` N+1 fix, `raw` + `realpath` + `stack` убран
- `config/doc_types/upt_*.json:15` — 5 типов УПТ
- `config/prompts/templates/types/*.md:1` — 8 per-type промптов
- `ui/app.js:320` — `showVerifyPdf` fix, `ui/style.css:1` — light
- `docs/LINUX_OLLAMA.md:1` — Linux on-prem
- `C:\Документы по ДТП\ДТП в суд_20260808\Разобранные PDF/02 Цессия (УПТ)` — 1223 исходника
- `C:\Документы по ДТП\ДТП в суд_20260808\структура.txt:1` — 10421/139

## Контекст

- `structure.txt` — не истина, папки с ошибками (2 `Договор УПТ` ушли в `УПТЮ` по содержимому — модель права, имя рандом)
- `input` рандом `doc_*.pdf` — модель не подсматривает, `docId` от контента `orchestrator.js:117`
- `35B A3B` MoE — не dense, 32k на 5070 ок, не паниковать
- `input/output/staging/config/debug` — могут содержать ПДн, в `.gitignore`, не пушить

## Команды для проверки

```bash
npm run config:doctor
npm run dry-run
npm run extract        # 57 файлов ~10м one-pass, ~16м two-pass
npm run ui             # http://127.0.0.1:4173 → Проверка
npm run test:golden    # 5 кейсов upt_*
node --check src/lib/llm.js && node --check src/components/normalize-fields.js
```

## Следующий шаг

Открыть `http://127.0.0.1:4173` → `Проверка` → прокликать `doc_027` `Договор УПТ 05 08 2024 УПТ-2` vs PDF, затем `git pull` в офисе и `OLLAMA_BASE_URL` в `.env`.
