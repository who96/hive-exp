import { Ajv, type ErrorObject, type ValidateFunction } from 'ajv';

import eventSchema from './event.schema.json' with { type: 'json' };
import experienceSchema from './experience.schema.json' with { type: 'json' };

const EXPERIENCE_ID_PATTERN = /^exp_\d+_[a-f0-9]{8}$/;
const EVENT_ID_PATTERN = /^evt_\d+_[a-f0-9]{8}$/;
const ISO_8601_UTC_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

const ajv = new Ajv({
  allErrors: true,
  strict: false
});
ajv.addFormat('date-time', {
  type: 'string',
  validate: (value) => ISO_8601_UTC_PATTERN.test(value)
});

const validateExperienceSchema = ajv.compile(experienceSchema) as ValidateFunction<unknown>;
const validateEventSchema = ajv.compile(eventSchema) as ValidateFunction<unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function formatErrors(errors: ErrorObject[] | null | undefined): string[] {
  if (!errors || errors.length === 0) {
    return [];
  }

  return errors.map((error) => {
    const basePath = error.instancePath ? `$${error.instancePath}` : '$';

    if (error.keyword === 'required' && typeof (error.params as { missingProperty?: unknown }).missingProperty === 'string') {
      return `${basePath}/${(error.params as { missingProperty: string }).missingProperty} ${error.message ?? 'is required'}`;
    }

    return `${basePath} ${error.message ?? 'is invalid'}`;
  });
}

function ensurePattern(
  errors: string[],
  path: string,
  value: unknown,
  pattern: RegExp,
  expected: string
): void {
  if (typeof value === 'string' && !pattern.test(value)) {
    errors.push(`${path} must match ${expected}`);
  }
}

export function validateExperience(data: unknown): { valid: boolean; errors: string[] } {
  const schemaValid = validateExperienceSchema(data);
  const errors = formatErrors(validateExperienceSchema.errors);

  if (isRecord(data)) {
    ensurePattern(errors, '$/id', data.id, EXPERIENCE_ID_PATTERN, '/^exp_\\d+_[a-f0-9]{8}$/');
  }

  const uniqueErrors = [...new Set(errors)];
  return {
    valid: schemaValid === true && uniqueErrors.length === 0,
    errors: uniqueErrors
  };
}

export function validateEvent(data: unknown): { valid: boolean; errors: string[] } {
  const schemaValid = validateEventSchema(data);
  const errors = formatErrors(validateEventSchema.errors);

  if (isRecord(data)) {
    ensurePattern(errors, '$/event_id', data.event_id, EVENT_ID_PATTERN, '/^evt_\\d+_[a-f0-9]{8}$/');
  }

  const uniqueErrors = [...new Set(errors)];
  return {
    valid: schemaValid === true && uniqueErrors.length === 0,
    errors: uniqueErrors
  };
}
