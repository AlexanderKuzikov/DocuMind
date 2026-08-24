import { makeError } from '../lib/error-reporter.js';

export const meta = {
  id: 'normalize-fields',
  version: '0.2.0',
  input: ['firstPassResult', 'rawExtracted'],
  output: ['finalDocument']
};

function normalizeDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  const dmy = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dmy) {
    const [, day, month, year] = dmy;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    const [, year, month, day] = iso;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  return text;
}

function normalizeDigits(value) {
  if (value === null || value === undefined) return null;
  return String(value).replace(/\D/g, '');
}

function normalizePhone(value) {
  if (!value) return null;
  const digits = String(value).replace(/\D/g, '');
  if (digits.startsWith('7') && digits.length === 11) return `+${digits}`;
  if (digits.length === 10) return `+7${digits}`;
  return value;
}

function normalizePersonName(value) {
  if (!value) return value;
  let s = String(value).trim();
  // Strip leading status prefixes that VLM sometimes captures: "Гражданин РФ", "Гражданка РФ", "РФ"
  // e.g. "Гражданин РФ Рябов А.В." -> "Рябов А.В.", "РФ Рябов Александр Владимирович" -> "Рябов Александр Владимирович"
  s = s.replace(/^(?:гражданин(?:ка)?\s+рф|гражданин(?:ка)?|рф)\s+/iu, '').trim();
  // Re-apply once in case of double prefix like "Гражданин РФ ...": after first replace, "РФ ..." may remain (already handled by alternation, but safe)
  s = s.replace(/^(?:рф)\s+/iu, '').trim();
  return s;
}

const PERSON_FIELDS = new Set(['debtor', 'cedent', 'cessionary', 'recipient']);

function normalizeField(field, value) {
  if (value === undefined) return null;
  let result = value;
  for (const rule of field.normalization || []) {
    if (rule === 'uppercase') result = String(result).toLocaleUpperCase('ru-RU');
    if (rule === 'lowercase') result = String(result).toLocaleLowerCase('ru-RU');
    if (rule === 'trim') result = String(result).trim();
    if (rule === 'person') result = normalizePersonName(result);
    if (rule === 'digits-only') result = normalizeDigits(result);
    if (rule === 'phone') result = normalizePhone(result);
    if (rule === 'date') result = normalizeDate(result);
    if (rule.startsWith('length:')) {
      const lengthSpec = rule.split(':')[1];
      const allowedLengths = lengthSpec.split('|').map((item) => Number(item.trim())).filter(Number.isFinite);
      if (allowedLengths.length > 1) {
        const text = String(result);
        result = allowedLengths.includes(text.length) ? text : text.slice(0, Math.max(...allowedLengths));
      } else {
        const length = Number(lengthSpec);
        result = String(result).slice(0, length);
      }
    }
  }
  if (field.type === 'date' && !field.normalization?.includes('date')) result = normalizeDate(result);
  if (field.type === 'array' && result !== null && result !== undefined && !Array.isArray(result)) result = [result];
  return result;
}

function collectFields(raw, target = {}, prefix = '', depth = 0) {
  if (raw === null || raw === undefined) return target;
  if (depth > 20) return target;
  if (Array.isArray(raw) || (raw && typeof raw === 'object')) {
    if (Array.isArray(raw)) {
      target[prefix] = raw;
      return target;
    }
    for (const [key, value] of Object.entries(raw)) {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      if (Array.isArray(value) || (value && typeof value === 'object')) {
        collectFields(value, target, nextPrefix, depth + 1);
      } else {
        target[nextPrefix] = value;
      }
    }
    return target;
  }
  target[prefix] = raw;
  return target;
}

function pickField(fields, aliases) {
  for (const alias of aliases) {
    const value = fields?.[alias];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

function applyTypeAliases(docTypeConfig, fields) {
  if (!docTypeConfig) return fields;
  const result = { ...fields };
  const fieldDefs = docTypeConfig.fields || docTypeConfig.firstPassFields || [];
  for (const fieldDef of fieldDefs) {
    const aliases = fieldDef.aliases || [];
    if (aliases.length > 0) {
      result[fieldDef.id] = pickField(fields, [fieldDef.id, ...aliases]) || null;
    }
  }
  return result;
}

export async function run(context) {
  const firstPass = context.artifacts.firstPassResult || {};
  const rawExtracted = context.artifacts.rawExtracted || {};
  const rawFields = rawExtracted.fields || rawExtracted.extractedData || rawExtracted;
  const fields = collectFields(rawFields, {});

  for (const [key, value] of Object.entries(firstPass.fields || {})) {
    if (value !== undefined) fields[key] = value;
  }

  const docType = firstPass.docType || rawExtracted.docType || rawExtracted.docTypeGuess || 'unknown';
  const docTypeConfig = context.docTypes.find((item) => item.type === docType) || null;
  const typedFields = applyTypeAliases(docTypeConfig, fields);
  // normalize according to docType field definitions
  for (const field of docTypeConfig?.fields || docTypeConfig?.firstPassFields || []) {
    if (typedFields[field.id] !== undefined && typedFields[field.id] !== null && typedFields[field.id] !== '') {
      typedFields[field.id] = normalizeField(field, typedFields[field.id]);
      // Person-field prefix cleanup: fallback even if "person" rule not listed (legacy configs / golden)
      if (PERSON_FIELDS.has(field.id) && typeof typedFields[field.id] === 'string') {
        typedFields[field.id] = normalizePersonName(typedFields[field.id]);
      }
    }
  }

  const errors = [];
  for (const field of docTypeConfig?.fields || docTypeConfig?.firstPassFields || []) {
    if (!field.required) continue;
    if (typedFields[field.id] === undefined || typedFields[field.id] === null || typedFields[field.id] === '') {
      errors.push(makeError('REQUIRED_FIELD_MISSING', `Required field is missing: ${field.id}`, meta.id, {
        recoverable: true,
        suggestions: ['repeat extraction', 'check source image quality', 'review debug prompts/responses']
      }));
    }
  }

  const finalDocument = {
    docId: context.document.id,
    docType,
    docTypeName: docTypeConfig?.name || 'Unknown document type',
    status: errors.length ? 'partial' : 'ok',
    confidence: firstPass.confidence ?? rawExtracted.confidence ?? null,
    outputNaming: docTypeConfig?.outputNaming || null,
    ...typedFields,
    createdAt: new Date().toISOString()
  };

  return {
    ok: true,
    artifacts: { finalDocument }
  };
}
