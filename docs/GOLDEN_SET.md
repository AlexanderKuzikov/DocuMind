# Golden set testing

Golden set testing is planned as a separate test layer.

It should run the same pipeline as production, but against fixed fixtures.

## Directory structure

```text
golden/
  passport/
    passport-001/
      input/
        document.pdf
      expected.json
      config.json
```

## Expected file

```json
{
  "docType": "passport",
  "status": "ok",
  "fields": {
    "series": "4510",
    "number": "123456",
    "birth_date": "1990-01-01"
  }
}
```

## Purpose

Golden tests should answer:

- did the model identify the document type correctly?
- did the output fields match expectations?
- did the result regress after prompt/config/model changes?

## Current status

The golden runner exists, but the fixture set is still empty.

This is intentional for the MVP stage.

## Future work

- add real fixtures;
- compare `fields`, `docType`, and `status`;
- save detailed diffs;
- run golden tests manually before changing prompts or models.
