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

function normalizeField(field, value) {
  if (value === undefined) return null;
  let result = value;
  for (const rule of field.normalization || []) {
    if (rule === 'uppercase') result = String(result).toLocaleUpperCase('ru-RU');
    if (rule === 'lowercase') result = String(result).toLocaleLowerCase('ru-RU');
    if (rule === 'trim') result = String(result).trim();
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

function collectFields(raw, target = {}, prefix = '') {
  if (raw === null || raw === undefined) return target;
  if (Array.isArray(raw) || (raw && typeof raw === 'object')) {
    if (Array.isArray(raw)) {
      target[prefix] = raw;
      return target;
    }
    for (const [key, value] of Object.entries(raw)) {
      const nextPrefix = prefix ? `${prefix}.${key}` : key;
      if (Array.isArray(value) || (value && typeof value === 'object')) {
        collectFields(value, target, nextPrefix);
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

function applyTypeAliases(docType, fields) {
  if (docType === 'egrul_extract') {
    return {
      ...fields,
      ogrn: pickField(fields, ['ogrn', 'OGRN', 'ОГРН']) || fields.ogrn || null,
      registration_record_date: pickField(fields, ['registration_record_date', 'registration_date', 'record_date', 'date_of_record', 'date']) || null,
      short_name_ru: pickField(fields, ['short_name_ru', 'legal_entity_short_name', 'shortNameRu', 'short_name']) || null
    };
  }

  if (docType === 'vehicle_registration_certificate') {
    return {
      ...fields,
      vin: pickField(fields, ['vin', 'VIN', 'vehicle_identification_number']) || null,
      vehicle_number: pickField(fields, ['vehicle_number', 'stateRegistrationNumber', 'registration_number', 'license_plate', 'licensePlate', 'номер машины', 'Номер машины']) || null
    };
  }

  if (docType === 'traffic_accident_participants') {
    return {
      ...fields,
      accident_location: pickField(fields, ['accident_location', 'location', 'place', 'address', 'Место ДТП', 'Адрес ДТП']) || null,
      accident_date: pickField(fields, ['accident_date', 'date', 'Дата ДТП']) || null
    };
  }

  return fields;
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
  const typedFields = applyTypeAliases(docType, fields);

  const errors = [];
  for (const field of docTypeConfig?.fields || docTypeConfig?.firstPassFields || []) {
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
