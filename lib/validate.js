'use strict';

/**
 * lib/validate.js  —  Request body validation helper.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────────
 *
 *   const { validate } = require('../lib/validate');
 *
 *   const SCHEMA = {
 *     email:     { type: 'string', required: true,  format: 'email' },
 *     firstName: { type: 'string', required: false, maxLength: 100 },
 *     age:       { type: 'number', required: false, min: 0, max: 150 },
 *     role:      { type: 'string', required: true,  enum: ['admin', 'user'] },
 *   };
 *
 *   const { ok, errors, data } = validate(SCHEMA, body);
 *   if (!ok) return sendJson(res, 400, { error: errors[0], errors }), true;
 *   // data is the cleaned, coerced body — use it instead of body directly
 *
 * ── Schema field options ───────────────────────────────────────────────────────
 *
 *   type        'string' | 'number' | 'boolean' | 'array' | 'object'
 *               If omitted, no type check is performed.
 *   required    boolean (default: false)
 *               If true and field is missing/empty, validation fails.
 *   default     Any value used when field is absent and not required.
 *   enum        string[]  — value must be one of the listed options.
 *   format      'email'   — additional format check (string only).
 *   minLength   number    — minimum string length (string only).
 *   maxLength   number    — maximum string length (string only).
 *   min         number    — minimum value (number only).
 *   max         number    — maximum value (number only).
 *   items       object    — schema applied to each element (array only).
 *                           Only type check is applied to items currently.
 *
 * ── Strictness ────────────────────────────────────────────────────────────────
 *
 *   Unknown fields (not in schema) are REJECTED with a 400-level error message.
 *   This is intentional — it prevents silent data loss and makes API contracts
 *   explicit. If you add a new field to the frontend, add it to the schema first.
 *
 * ── Result shape ──────────────────────────────────────────────────────────────
 *
 *   {
 *     ok:     boolean,          // true if all checks passed
 *     errors: string[],         // human-readable error messages (empty if ok)
 *     data:   object            // cleaned body — use this, not the raw body
 *   }
 */

// ---------------------------------------------------------------------------
// Email format check
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isValidEmail(value) {
  return EMAIL_RE.test(String(value));
}

// ---------------------------------------------------------------------------
// Core validator
// ---------------------------------------------------------------------------

/**
 * Validate a request body against a schema.
 *
 * @param   {Record<string, object>} schema  - Field definitions (see above)
 * @param   {object}                 body    - Parsed request body
 * @returns {{ ok: boolean, errors: string[], data: object }}
 */
function validate(schema, body) {
  const errors = [];
  const data   = {};

  // ── Unknown field check (strict mode) ────────────────────────────────────
  const knownKeys   = new Set(Object.keys(schema));
  const unknownKeys = Object.keys(body || {}).filter(k => !knownKeys.has(k));
  if (unknownKeys.length) {
    errors.push(
      `Unknown field${unknownKeys.length > 1 ? 's' : ''}: ${unknownKeys.join(', ')}. ` +
      `Allowed fields: ${[...knownKeys].join(', ')}.`
    );
  }

  // ── Per-field checks ─────────────────────────────────────────────────────
  for (const [key, rules] of Object.entries(schema)) {
    const raw     = body != null ? body[key] : undefined;
    const absent  = raw === undefined || raw === null || raw === '';

    // Required check
    if (rules.required && absent) {
      errors.push(`"${key}" is required.`);
      continue;
    }

    // Use default if absent and not required
    if (absent) {
      if (rules.default !== undefined) data[key] = rules.default;
      continue;
    }

    let value = raw;

    // ── Type coercion + check ─────────────────────────────────────────────
    if (rules.type) {
      switch (rules.type) {
        case 'string':
          if (typeof value !== 'string') {
            // Coerce numbers/booleans to string; reject objects/arrays
            if (typeof value === 'number' || typeof value === 'boolean') {
              value = String(value);
            } else {
              errors.push(`"${key}" must be a string.`);
              continue;
            }
          }
          value = value.trim();
          break;

        case 'number':
          if (typeof value === 'string' && value.trim() !== '' && !isNaN(Number(value))) {
            value = Number(value);
          }
          if (typeof value !== 'number' || isNaN(value)) {
            errors.push(`"${key}" must be a number.`);
            continue;
          }
          break;

        case 'boolean':
          if (value === 'true')  value = true;
          if (value === 'false') value = false;
          if (typeof value !== 'boolean') {
            errors.push(`"${key}" must be a boolean (true or false).`);
            continue;
          }
          break;

        case 'array':
          if (!Array.isArray(value)) {
            errors.push(`"${key}" must be an array.`);
            continue;
          }
          // Item type check
          if (rules.items && rules.items.type) {
            const badItems = value.filter(item => typeof item !== rules.items.type);
            if (badItems.length) {
              errors.push(`"${key}" must be an array of ${rules.items.type}s.`);
              continue;
            }
          }
          break;

        case 'object':
          if (typeof value !== 'object' || Array.isArray(value) || value === null) {
            errors.push(`"${key}" must be an object.`);
            continue;
          }
          break;

        default:
          // Unknown type in schema — developer error, warn and skip type check
          console.warn(`[validate] Unknown type "${rules.type}" for field "${key}"`);
      }
    }

    // ── String-specific checks ────────────────────────────────────────────
    if (rules.type === 'string' || typeof value === 'string') {
      if (rules.minLength !== undefined && value.length < rules.minLength) {
        errors.push(`"${key}" must be at least ${rules.minLength} character${rules.minLength !== 1 ? 's' : ''}.`);
        continue;
      }
      if (rules.maxLength !== undefined && value.length > rules.maxLength) {
        errors.push(`"${key}" must be no more than ${rules.maxLength} characters.`);
        continue;
      }
      if (rules.format === 'email' && !isValidEmail(value)) {
        errors.push(`"${key}" must be a valid email address.`);
        continue;
      }
    }

    // ── Number-specific checks ────────────────────────────────────────────
    if (rules.type === 'number' || typeof value === 'number') {
      if (rules.min !== undefined && value < rules.min) {
        errors.push(`"${key}" must be at least ${rules.min}.`);
        continue;
      }
      if (rules.max !== undefined && value > rules.max) {
        errors.push(`"${key}" must be no more than ${rules.max}.`);
        continue;
      }
    }

    // ── Enum check ────────────────────────────────────────────────────────
    if (rules.enum) {
      if (!rules.enum.includes(value)) {
        errors.push(`"${key}" must be one of: ${rules.enum.map(v => `"${v}"`).join(', ')}.`);
        continue;
      }
    }

    data[key] = value;
  }

  return {
    ok:     errors.length === 0,
    errors,
    data,
  };
}

// ---------------------------------------------------------------------------
// Convenience: validate and send a 400 response automatically if invalid.
// Returns the cleaned data if valid, or null if invalid (response already sent).
//
// Usage:
//   const data = await validateOrReject(schema, body, res);
//   if (!data) return true;  // response already sent
//   // use data...
// ---------------------------------------------------------------------------

function validateOrReject(schema, body, res) {
  const { sendJson } = require('../routes/http');
  const result = validate(schema, body);
  if (!result.ok) {
    sendJson(res, 400, { error: result.errors[0], errors: result.errors });
    return null;
  }
  return result.data;
}

module.exports = { validate, validateOrReject, isValidEmail };
