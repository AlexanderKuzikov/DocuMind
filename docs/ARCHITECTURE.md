# Architecture

DocuMind is built as a small, config-driven orchestrator for legal/document extraction workflows.

The repository keeps the extensible component architecture, but the current active mode is a focused MVP:

```text
grouped input document
  → one assembled PDF
  → one-pass docType detection
  → one-pass field extraction
  → normalized JSON
  → renamed PDF + JSON in output/
```

## Active MVP pipeline

Configured in `config/config.jsonc`:

```text
discover-documents
  ↓
assemble-document-pdf
  ↓
build-universal-prompt
  ↓
llm-universal-pass
  ↓
normalize-fields
  ↓
write-output
```

Disabled legacy components are still present for future development:

```text
rasterize-first-page
build-specific-prompt
llm-specific-pass
```

They are not deleted. They are just disabled in the active pipeline.

## Components

Each component lives in `src/components/` and exports:

```js
export const meta = {
  id: 'component-id',
  version: '0.1.0',
  input: [],
  output: []
};

export async function run(context) {
  // ...
}
```

Components do not import each other. They communicate only through the shared `context`.

## Document grouping

`discover-documents` groups documents from `input/`:

```text
top-level file  → one document
top-level dir   → one document
```

Inside a grouped document, supported files are collected and later assembled into one PDF.

Incoming file names are not used for:

- document type detection;
- output naming;
- field extraction.

Document type is detected from document content.

## PDF assembly

`assemble-document-pdf` creates one normalized PDF per document.

Supported inputs:

- PDF;
- PNG;
- JPG/JPEG;
- WebP.

Behavior:

- PDF pages are rasterized;
- images are converted to JPEG;
- page/image dimensions are rounded to integer PDF units;
- all pages/files are assembled into one PDF;
- the first page image is passed to the LLM.

The component writes assembled artifacts to `staging/<docId>/`.

## One-pass extraction

The MVP prompt is:

```text
config/prompts/templates/one-pass.md
```

It is rendered by `build-universal-prompt` when:

```jsonc
{
  "extraction": {
    "mode": "one-pass"
  }
}
```

The model must return strict JSON:

```json
{
  "docType": "egrul_extract | vehicle_registration_certificate | traffic_accident_participants | unknown",
  "confidence": 0.95,
  "fields": {
    "field_id": "value"
  }
}
```

The prompt explicitly forbids using the incoming filename.

## Registered MVP document types

### `egrul_extract`

Name:

```text
Выписка из ЕГРЮЛ
```

Fields:

```text
ogrn
registration_record_date
short_name_ru
```

Important rule:

```text
registration_record_date is the date of the EGRUL record entry, not the extract issue date.
```

Output template:

```text
Выписка из ЕГРЮЛ {short_name_ru} от {registration_record_date}
```

### `vehicle_registration_certificate`

Name:

```text
Свидетельство о регистрации ТС
```

Fields:

```text
vin
vehicle_number
```

Output template:

```text
СТС {vehicle_number}
```

### `traffic_accident_participants`

Name:

```text
Сведения об участниках ДТП
```

Fields:

```text
accident_location
accident_date
```

Important rule:

```text
accident_location is labelled as "Место ДТП", because it can be an address, road, highway segment, or other landmark.
```

Output template:

```text
Сведения об участниках ДТП {accident_date}
```

## Normalization

`normalize-fields` is responsible for:

- reading `docType` from the one-pass JSON;
- mapping technical fields;
- normalizing dates to `YYYY-MM-DD`;
- normalizing VIN/vehicle number to uppercase;
- checking required fields;
- setting `confidence`;
- keeping `outputNaming` as an internal naming hint;
- preparing a flat final document object for `write-output`.

## Output writer

`write-output` writes two files to `output/`:

```text
output/<name>.pdf
output/<name>.json
```

The JSON is flat and does not include debug/internal fields such as `source`, `validation`, `selectedDocType`, or `outputNaming`.

```text
docId
docType
docTypeName
status
confidence
document fields as top-level keys
createdAt
pdfFileName
jsonFileName
```

If an output name already exists, the writer adds a numeric suffix such as `_001`.

## Config

Main config:

```text
config/config.jsonc
```

Doc types:

```text
config/doc_types/*.json
```

Field mappings:

```text
config/field_mappings.json
```

Prompt templates:

```text
config/prompts/templates/*.md
```

## Orchestration

`src/orchestrator.js` is responsible for:

- loading config;
- loading doc types;
- loading components;
- generating `docId` as `dm-YYYYMMDDHHMMSS-<content-hash>-<run-suffix>`;
- running the pipeline in order;
- creating/closing LLM sessions;
- writing debug artifacts;
- enforcing sequential execution with a pipeline lock.

The `docId` is not derived from the incoming filename. It is derived from file content hashes/sizes plus a run suffix.

The orchestrator should stay “dumb”: no business logic inside it.

## LLM session policy

Current default:

```json
{
  "llm": {
    "imagePolicy": "session",
    "sessionFallback": "each-pass"
  }
}
```

Meaning:

```text
The assembled first-page image and one-pass prompt are sent once.
If the provider does not retain session context, fallback sends the image in each pass.
```

For the current MVP there is only one LLM pass.

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

## Data policy

Real legal documents with personal data must not be sent to external LLM services.

Profiles:

- `local-lmstudio` — local experiments;
- `mvp-routerai` — dev/sandbox/anonymized fixtures;
- `prod-ollama` — target on-prem/office server.

`input/`, `output/`, `staging/`, `debug/`, and golden reports may contain personal data and must not be committed.
