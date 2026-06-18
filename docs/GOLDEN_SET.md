# Golden set testing

Golden set testing is planned as a separate test layer.

It should run the same pipeline as production, but against fixed fixtures.

## Current status

The golden runner exists, but the fixture set is still empty.

This is intentional for the current MVP stage, but it must be filled before the product can be treated as stable.

## Active MVP document types for golden fixtures

### `egrul_extract`

Name:

```text
Выписка из ЕГРЮЛ
```

Expected fields:

```json
{
  "docType": "egrul_extract",
  "status": "ok",
  "confidence": 0.98,
  "ogrn": "1045900353443",
  "registration_record_date": "YYYY-MM-DD",
  "short_name_ru": "ООО \"...\""
}
```

Important rule:

```text
registration_record_date is the EGRUL record entry date, not the extract issue date.
```

Expected output name:

```text
Выписка из ЕГРЮЛ {short_name_ru} от {registration_record_date}
```

### `vehicle_registration_certificate`

Name:

```text
Свидетельство о регистрации ТС
```

Expected fields:

```json
{
  "docType": "vehicle_registration_certificate",
  "status": "ok",
  "confidence": 0.95,
  "vin": "X7L4SRLVA64034752",
  "vehicle_number": "M57TM159"
}
```

Expected output name:

```text
СТС {vehicle_number}
```

### `traffic_accident_participants`

Name:

```text
Сведения об участниках ДТП
```

Expected fields:

```json
{
  "docType": "traffic_accident_participants",
  "status": "ok",
  "confidence": 0.95,
  "accident_location": "...",
  "accident_date": "YYYY-MM-DD"
}
```

Important rule:

```text
accident_location is labelled as "Место ДТП", because it can be an address, road, highway segment, or other landmark.
```

Expected output name:

```text
Сведения об участниках ДТП {accident_date}
```

## Directory structure

```text
golden/
  egrul_extract/
    egrul_extract-001/
      input/
        document.pdf
      expected.json
      config.json

  vehicle_registration_certificate/
    vehicle_registration_certificate-001/
      input/
        document.pdf
      expected.json
      config.json

  traffic_accident_participants/
    traffic_accident_participants-001/
      input/
        document.pdf
      expected.json
      config.json
```

## Expected file

A golden expected file should compare at least:

```json
{
  "docType": "egrul_extract",
  "status": "ok",
  "confidence": 0.98,
  "ogrn": "1045900353443",
  "registration_record_date": "2025-12-10",
  "short_name_ru": "ООО \"ТЕХНОРЕСУРС ПЛЮС\""
}
```

## Purpose

Golden tests should answer:

- did the model identify the document type correctly?
- did the output fields match expectations?
- did the output PDF/JSON naming match the configured template?
- did the result regress after prompt/config/model changes?
- did the PDF assembly preserve all pages/files of the document?

## Future work

- add real fixtures for the three active MVP types;
- compare `docType`, `status`, `confidence`, document fields, `pdfFileName`, and `jsonFileName`;
- save detailed diffs;
- run golden tests manually before changing prompts or models;
- add separate fixtures for PDFs, images, and grouped folder documents;
- add RouterAI and Ollama-specific golden runs once those profiles are verified.
