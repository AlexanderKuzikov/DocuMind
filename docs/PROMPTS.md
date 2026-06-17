# Prompting

DocuMind uses dynamic prompts assembled from:

```text
config/config.jsonc
config/doc_types/*.json
config/prompts/templates/*.md
```

## Universal prompt

Template:

```text
config/prompts/templates/universal.md
```

Purpose:

```text
- determine docType;
- extract 2-3 anchor fields;
- keep the prompt small;
- receive allowed doc types from `{{allowedDocTypes}}`.
```

## Specific / legal extraction prompt

Template:

```text
config/prompts/templates/specific.md
```

Purpose:

```text
- extract everything that may be legally useful;
- use the already detected doc type;
- use `secondPassFields` and `validationRules` from `config/doc_types/<type>.json`;
- return strict JSON;
- do not add prose.
```

This is intentionally broad.

The model is not forced into a narrow schema yet.

## Unknown prompt

Template:

```text
config/prompts/templates/generic-unknown.md
```

Used when the universal pass returns:

```json
{
  "docType": "unknown"
}
```

Even in this case the system should still try to extract useful data.

## Debug artifacts

If debug is enabled, DocuMind saves:

```text
debug/<docId>/universal.prompt.md
debug/<docId>/universal.response.json
debug/<docId>/specific.prompt.md
debug/<docId>/specific.response.json
debug/<docId>/output.json
```

This is important because prompts are dynamic.

We do not freeze prompt text.
We freeze the rendered prompt for each run.
