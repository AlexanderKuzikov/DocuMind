Ты определяешь тип документа и извлекаешь несколько базовых полей.

Доступные типы документов:

{{typesList}}

Для каждого типа учитывай признаки:

{{recognitionFeatures}}

Извлеки только базовые поля первого прохода:

{{firstPassFields}}

Верни строго JSON:

{
  "docType": "passport | invoice | marriage_certificate | traffic_accident_appendix | unknown",
  "confidence": 0.0,
  "fields": {}
}

Правила:
- если тип не определён, верни "unknown";
- не выдумывай значения;
- если поле не найдено, верни null;
- отвечай только JSON, без markdown и пояснений.
