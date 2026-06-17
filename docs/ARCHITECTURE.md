# Architecture

DocuMind is built as a small, config-driven orchestrator.

## Pipeline

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

## Components

Each component lives in `src/components/` and has a `run(context)` function.

Components do not import each other. They communicate only through the shared `context`.

## Orchestration

`src/orchestrator.js` is responsible for:

- loading config;
- loading doc types;
- loading components;
- running the pipeline in order;
- creating/closing LLM sessions;
- writing debug artifacts;
- enforcing sequential execution with a pipeline lock.

The orchestrator should stay “dumb”: no business logic inside it.

## Config

Main config:

```text
config/config.jsonc
```

Doc types:

```text
config/doc_types/*.json
```

Prompt templates:

```text
config/prompts/templates/*.md
```

## LLM session policy

Current default:

```json
{
  "llm": {
    "imagePolicy": "session"
  }
}
```

Meaning:

```text
Pass 1: image + universal prompt
Pass 2: previous result + legal extraction prompt
```

If the provider does not support session retention, fallback should be configured via:

```json
{
  "llm": {
    "sessionFallback": "each-pass"
  }
}
```

The orchestrator owns the shared session when `imagePolicy: "session"`. Individual LLM components can create and close their own short-lived session when no shared session exists.

## Output

The final output is a JSON file in `output/`.

It contains:

```text
docId
docType
docTypeName
status
source
firstPass
rawExtracted
fields
validation
crm
createdAt
```

## Error handling

The system should fail loudly but clearly.

Errors should include:

```text
code
message
stage
recoverable
probableCauses
suggestions
```

The user should see what happened, where it happened, and what can be done next.
