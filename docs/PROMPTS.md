# Prompting

DocuMind uses dynamic prompts assembled from:

```text
config/config.jsonc
config/doc_types/*.json
config/prompts/templates/*.md
```

The active MVP prompt is:

```text
config/prompts/templates/one-pass.md
```

## Active MVP prompt

Template:

```text
config/prompts/templates/one-pass.md
```

Purpose:

```text
- determine docType from document content;
- extract 2–3 required fields for the detected doc type;
- return strict JSON only;
- ignore the incoming filename;
- support one-pass extraction.
```

Allowed doc types are rendered from `config/doc_types/*.json`, so adding/removing a type does not require changing the prompt template.

## One-pass JSON contract

The model should return:

```json
{
  "docType": "egrul_extract | vehicle_registration_certificate | traffic_accident_participants | unknown",
  "confidence": 0.95,
  "fields": {
    "field_id": "value"
  }
}
```

The final output JSON is flat. `normalize-fields` and `write-output` move model fields to top-level keys and do not keep `fields`, `validation`, `source`, or `selectedDocType` in the final file.

```json
{
  "docId": "dm-YYYYMMDDHHMMSS-<content-hash>-<run-suffix>",
  "docType": "vehicle_registration_certificate",
  "docTypeName": "Свидетельство о регистрации ТС",
  "status": "ok",
  "confidence": 0.95,
  "vin": "X7L4SRLVA64034752",
  "vehicle_number": "M57TM159",
  "createdAt": "...",
  "pdfFileName": "СТС M57TM159.pdf",
  "jsonFileName": "СТС M57TM159.json"
}
```

Rules:

```text
- Do not use the incoming filename.
- Do not invent missing values.
- If a field is missing, return null.
- Dates should be normalized to YYYY-MM-DD when possible.
- Return only JSON, without markdown or explanations.
```

### `egrul_extract` — Выписка из ЕГРЮЛ

Fields:

```text
ogrn
registration_record_date
short_name_ru
```

Important rule:

```text
registration_record_date must be the date of the EGRUL record entry, not the extract issue date.
```

Output naming uses:

```text
Выписка из ЕГРЮЛ {short_name_ru} от {registration_record_date}
```

### `vehicle_registration_certificate` — Свидетельство о регистрации ТС

Fields:

```text
vin
vehicle_number
```

Output naming uses:

```text
СТС {vehicle_number}
```

### `traffic_accident_participants` — Сведения об участниках ДТП

Fields:

```text
accident_location
accident_date
```

Important rule:

```text
accident_location is understood as "Место ДТП", because it can be an address, road, highway segment, or other landmark.
```

Output naming uses:

```text
Сведения об участниках ДТП {accident_date}
```

## Legacy universal prompt

Template:

```text
config/prompts/templates/universal.md
```

Purpose in the legacy two-pass pipeline:

```text
- determine docType;
- extract 2–3 anchor fields;
- keep the prompt small;
- receive allowed doc types from {{allowedDocTypes}}.
```

It is still present for future use, but it is not the active MVP prompt.

## Legacy specific / legal extraction prompt

Template:

```text
config/prompts/templates/specific.md
```

Purpose in the legacy two-pass pipeline:

```text
- extract everything that may be legally useful;
- use the already detected doc type;
- use secondPassFields and validationRules from config/doc_types/<type>.json;
- return strict JSON;
- do not add prose.
```

It is intentionally broad and is disabled in the current MVP pipeline.

## Unknown prompt

Template:

```text
config/prompts/templates/generic-unknown.md
```

Used when the model returns:

```json
{
  "docType": "unknown"
}
```

Even in this case the system should still try to extract useful data.

## Debug artifacts

If debug is enabled, DocuMind saves:

```text
debug/<docId>/one-pass.prompt.md
debug/<docId>/one-pass.response.json
debug/<docId>/output.json
```

Legacy debug artifacts may also exist from previous pipeline versions:

```text
debug/<docId>/universal.prompt.md
debug/<docId>/universal.response.json
debug/<docId>/specific.prompt.md
debug/<docId>/specific.response.json
```

This is important because prompts are dynamic.

We do not freeze prompt text.
We freeze the rendered prompt for each run.
