import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeListingChanges,
  normalizeListingData,
  validatePersonalizationQuestions,
} from '../src/etsy-schema.mjs';

test('listing reads expose both type and listing_type', () => {
  assert.deepEqual(
    normalizeListingData({ listing_id: 1, listing_type: 'download' }),
    { listing_id: 1, listing_type: 'download', type: 'download', is_digital: true },
  );
  assert.deepEqual(
    normalizeListingData({ listing_id: 2, type: 'physical' }),
    { listing_id: 2, type: 'physical', listing_type: 'physical', is_digital: false },
  );
});

test('listing writes accept listing_type alias and send Etsy type', () => {
  assert.deepEqual(
    normalizeListingChanges({ listing_type: 'download', title: 'x' }),
    { type: 'download', title: 'x' },
  );
  assert.throws(
    () => normalizeListingChanges({ type: 'physical', listing_type: 'download' }),
    /cannot disagree/,
  );
});

test('personalization accepts current Etsy field limits', () => {
  const result = validatePersonalizationQuestions([
    {
      question_text: 'Your Script',
      instructions: 'Paste the exact script to speak.',
      question_type: 'text_input',
      required: true,
      max_allowed_characters: 1024,
      max_allowed_files: null,
      options: null,
      add_on_price: null,
    },
    {
      question_text: 'Video Format',
      instructions: null,
      question_type: 'dropdown',
      required: true,
      max_allowed_characters: null,
      max_allowed_files: null,
      options: [{ label: 'Horizontal' }, { label: 'Vertical' }],
    },
  ]);
  assert.equal(result.length, 2);
});

test('personalization rejects overlong instructions before Etsy does', () => {
  assert.throws(
    () => validatePersonalizationQuestions([{
      question_text: 'Your Script',
      instructions: 'x'.repeat(121),
      question_type: 'text_input',
      required: true,
      max_allowed_characters: 1024,
    }]),
    /120 characters/,
  );
});

test('personalization enforces question count and upload count', () => {
  assert.throws(() => validatePersonalizationQuestions([]), /between 1 and 5/);
  assert.throws(
    () => validatePersonalizationQuestions([
      {
        question_text: 'Photo One',
        question_type: 'unlabeled_upload',
        required: true,
        max_allowed_files: 1,
      },
      {
        question_text: 'Photo Two',
        question_type: 'unlabeled_upload',
        required: true,
        max_allowed_files: 1,
      },
    ]),
    /Only one upload-type/,
  );
});

test('dropdown option labels must be unique and within limits', () => {
  assert.throws(
    () => validatePersonalizationQuestions([{
      question_text: 'Video Format',
      question_type: 'dropdown',
      required: true,
      options: [{ label: 'Horizontal' }, { label: 'Horizontal' }],
    }]),
    /must be unique/,
  );
});

test('priced personalization is limited to optional text input', () => {
  assert.throws(
    () => validatePersonalizationQuestions([{
      question_text: 'Second Format',
      question_type: 'text_input',
      required: true,
      max_allowed_characters: 10,
      add_on_price: 6.9,
    }]),
    /only allowed on optional/,
  );
  assert.doesNotThrow(
    () => validatePersonalizationQuestions([{
      question_text: 'Second Format',
      question_type: 'text_input',
      required: false,
      max_allowed_characters: 10,
      add_on_price: 6.9,
    }]),
  );
});
