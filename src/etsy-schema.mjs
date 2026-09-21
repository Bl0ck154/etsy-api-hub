import { inputError } from './errors.mjs';

const QUESTION_TYPES = new Set([
  'text_input',
  'dropdown',
  'unlabeled_upload',
  'labeled_upload',
]);

function has(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function length(value) {
  return [...String(value ?? '')].length;
}

function beginsWithLetterOrNumber(value) {
  return /^[\p{L}\p{N}]/u.test(String(value ?? ''));
}

function uppercaseWordCount(value) {
  return String(value ?? '')
    .split(/\s+/u)
    .filter(Boolean)
    .filter(word => /^[\p{Lu}]{3,}/u.test(word)).length;
}

function positiveId(value, name) {
  const text = String(value ?? '').trim();
  if (!/^\d+$/.test(text) || Number(text) < 1) throw inputError(`${name} must be a positive numeric id`);
}

function nullishOnly(value, message) {
  if (value !== undefined && value !== null) throw inputError(message);
}

function moneyToNumber(value) {
  if (value == null) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'object' && Number.isFinite(Number(value.amount))) {
    const divisor = Number(value.divisor || 100);
    if (divisor > 0) return Number(value.amount) / divisor;
  }
  return null;
}

export function normalizeListingData(listing) {
  if (!listing || typeof listing !== 'object' || Array.isArray(listing)) return listing;
  const out = { ...listing };

  // Etsy live reads currently expose listing_type, while the public reference
  // and write API still use type. Friendly Hub reads expose both names.
  if (out.type == null && out.listing_type != null) out.type = out.listing_type;
  if (out.listing_type == null && out.type != null) out.listing_type = out.type;

  if (out.is_digital == null && out.type != null) {
    out.is_digital = out.type === 'download' || out.type === 'both';
  }
  return out;
}

export function normalizeListingCollection(data) {
  if (!data || typeof data !== 'object' || !Array.isArray(data.results)) return data;
  return { ...data, results: data.results.map(normalizeListingData) };
}

export function normalizeListingChanges(changes) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    throw inputError('Listing changes must be a JSON object');
  }

  const out = { ...changes };
  if (has(out, 'type') && has(out, 'listing_type') && out.type !== out.listing_type) {
    throw inputError('type and listing_type cannot disagree');
  }
  if (!has(out, 'type') && has(out, 'listing_type')) out.type = out.listing_type;
  delete out.listing_type;
  return out;
}

export function validatePersonalizationQuestions(questions) {
  if (!Array.isArray(questions)) throw inputError('personalization_questions must be an array');
  if (questions.length < 1 || questions.length > 5) {
    throw inputError('personalization_questions must contain between 1 and 5 questions');
  }

  let uploadQuestions = 0;
  const result = questions.map((question, index) => {
    if (!question || typeof question !== 'object' || Array.isArray(question)) {
      throw inputError(`personalization question ${index + 1} must be an object`);
    }

    const q = { ...question };
    const label = `personalization question ${index + 1}`;
    const type = String(q.question_type || '');

    if (!QUESTION_TYPES.has(type)) {
      throw inputError(`${label} has unsupported question_type: ${type || '<missing>'}`);
    }

    const questionText = String(q.question_text ?? '');
    if (length(questionText) < 1 || length(questionText) > 45) {
      throw inputError(`${label} question_text must be 1-45 characters`);
    }
    if (!beginsWithLetterOrNumber(questionText)) {
      throw inputError(`${label} question_text must begin with a letter or number`);
    }
    if (uppercaseWordCount(questionText) > 1) {
      throw inputError(`${label} question_text may not contain more than one word beginning with 3+ capital letters`);
    }

    if (q.question_id != null) positiveId(q.question_id, `${label} question_id`);
    if (typeof q.required !== 'boolean') throw inputError(`${label} required must be true or false`);

    const instructions = q.instructions == null ? null : String(q.instructions);
    if (instructions != null) {
      if (type === 'dropdown') throw inputError(`${label} instructions must be null/omitted for dropdown questions`);
      if (length(instructions) > 120) throw inputError(`${label} instructions cannot exceed 120 characters`);
      if (instructions && !beginsWithLetterOrNumber(instructions)) {
        throw inputError(`${label} instructions must begin with a letter or number`);
      }
      if (instructions && uppercaseWordCount(instructions) > 1) {
        throw inputError(`${label} instructions may not contain more than one word beginning with 3+ capital letters`);
      }
    }

    if (type === 'text_input') {
      const maxChars = Number(q.max_allowed_characters);
      if (!Number.isInteger(maxChars) || maxChars < 1 || maxChars > 1024) {
        throw inputError(`${label} max_allowed_characters must be an integer from 1 to 1024`);
      }
      nullishOnly(q.max_allowed_files, `${label} max_allowed_files is only valid for upload questions`);
      nullishOnly(q.options, `${label} options is only valid for dropdown/labeled_upload questions`);

      if (has(q, 'add_on_price') && q.add_on_price != null) {
        const price = Number(q.add_on_price);
        if (!Number.isFinite(price) || price < 0) {
          throw inputError(`${label} add_on_price must be null, 0, or a positive number`);
        }
        if (price > 0 && q.required) {
          throw inputError(`${label} add_on_price is only allowed on optional text_input questions`);
        }
      }
    } else {
      nullishOnly(q.max_allowed_characters, `${label} max_allowed_characters is only valid for text_input questions`);
      if (has(q, 'add_on_price') && q.add_on_price != null) {
        throw inputError(`${label} add_on_price is only valid for text_input questions`);
      }
    }

    if (type === 'unlabeled_upload' || type === 'labeled_upload') {
      uploadQuestions += 1;
      const maxFiles = Number(q.max_allowed_files);
      if (!Number.isInteger(maxFiles) || maxFiles < 1 || maxFiles > 10) {
        throw inputError(`${label} max_allowed_files must be an integer from 1 to 10`);
      }
      if (type === 'labeled_upload' && maxFiles < 2) {
        throw inputError(`${label} labeled_upload max_allowed_files must be at least 2`);
      }
    } else {
      nullishOnly(q.max_allowed_files, `${label} max_allowed_files is only valid for upload questions`);
    }

    if (type === 'dropdown' || type === 'labeled_upload') {
      if (!Array.isArray(q.options)) throw inputError(`${label} options must be an array`);

      if (type === 'dropdown' && (q.options.length < 1 || q.options.length > 30)) {
        throw inputError(`${label} dropdown must contain 1-30 options`);
      }
      if (type === 'labeled_upload' && q.options.length !== Number(q.max_allowed_files)) {
        throw inputError(`${label} labeled_upload options length must equal max_allowed_files`);
      }

      const seen = new Set();
      q.options = q.options.map((option, optionIndex) => {
        if (!option || typeof option !== 'object' || Array.isArray(option)) {
          throw inputError(`${label} option ${optionIndex + 1} must be an object`);
        }

        const optionLabel = String(option.label ?? '');
        const maxLabel = type === 'dropdown' ? 20 : 45;
        if (length(optionLabel) < 1 || length(optionLabel) > maxLabel) {
          throw inputError(`${label} option ${optionIndex + 1} label must be 1-${maxLabel} characters`);
        }

        if (type === 'dropdown') {
          if (seen.has(optionLabel)) throw inputError(`${label} dropdown option labels must be unique`);
          seen.add(optionLabel);
        }
        return { ...option, label: optionLabel };
      });
    } else {
      nullishOnly(q.options, `${label} options is only valid for dropdown/labeled_upload questions`);
    }

    return q;
  });

  if (uploadQuestions > 1) {
    throw inputError('Only one upload-type personalization question is allowed per listing');
  }
  return result;
}

export function preserveExistingAddOnPrices(questions, existingQuestions = []) {
  const existingById = new Map(
    existingQuestions
      .filter(q => q?.question_id != null)
      .map(q => [String(q.question_id), q]),
  );

  return questions.map(question => {
    if (
      question.question_type !== 'text_input'
      || has(question, 'add_on_price')
      || question.question_id == null
    ) return question;

    const existing = existingById.get(String(question.question_id));
    const currentPrice = moneyToNumber(existing?.add_on_price);
    if (currentPrice == null) return question;

    if (question.required && currentPrice > 0) {
      throw inputError(
        'A priced personalization question cannot become required unless add_on_price is explicitly removed with 0 or null',
      );
    }
    return { ...question, add_on_price: currentPrice };
  });
}
