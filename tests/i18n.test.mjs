import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// Load dictionaries by stripping TS annotations
const koSrc = fs.readFileSync('src/i18n/ko.ts', 'utf8')
  .replace(/import\s+.*?;/g, '')
  .replace(/as\s+TooltipItem/g, '')
  .replace('export const ko', 'const ko');

const enSrc = fs.readFileSync('src/i18n/en.ts', 'utf8')
  .replace(/import\s+.*?;/g, '')
  .replace(/as\s+TooltipItem/g, '')
  .replace('export const en', 'const en');

const ko = new Function(koSrc + '\nreturn ko;')();
const en = new Function(enSrc + '\nreturn en;')();

function translate(key, params, lang = 'ko') {
  const dict = lang === 'ko' ? ko : en;
  const fallbackDict = en;

  let val = dict[key];
  if (val === undefined || typeof val !== 'string') {
    val = fallbackDict[key];
  }

  if (val === undefined || typeof val !== 'string') {
    return key;
  }

  if (params) {
    let result = val;
    for (const [k, v] of Object.entries(params)) {
      result = result.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
    return result;
  }

  return val;
}

function getTooltip(key, lang = 'ko') {
  const dict = lang === 'ko' ? ko : en;
  const fallbackDict = en;

  let val = dict[key];
  if (!val || typeof val !== 'object') {
    val = fallbackDict[key];
  }

  if (val && typeof val === 'object' && 'title' in val && 'body' in val) {
    return val;
  }

  return undefined;
}

test('i18n: 100% dictionary key parity between Korean and English', () => {
  const koKeys = Object.keys(ko);
  const enKeys = Object.keys(en);

  const missingInEn = koKeys.filter((k) => !enKeys.includes(k));
  const missingInKo = enKeys.filter((k) => !koKeys.includes(k));

  assert.equal(missingInEn.length, 0, `Missing in English: ${missingInEn.join(', ')}`);
  assert.equal(missingInKo.length, 0, `Missing in Korean: ${missingInKo.join(', ')}`);
  assert.equal(koKeys.length, enKeys.length);
  assert.ok(koKeys.length >= 200, `Expected at least 200 translation keys, got ${koKeys.length}`);
});

test('i18n: Value type parity across all keys', () => {
  for (const key of Object.keys(ko)) {
    const koVal = ko[key];
    const enVal = en[key];

    const koType = typeof koVal;
    const enType = typeof enVal;

    assert.equal(koType, enType, `Type mismatch for key "${key}": KO is ${koType}, EN is ${enType}`);

    if (koType === 'string') {
      assert.ok(koVal.trim().length > 0, `KO string for "${key}" is empty`);
      assert.ok(enVal.trim().length > 0, `EN string for "${key}" is empty`);
    }
  }
});

test('i18n: TooltipItem schema conformity', () => {
  const tooltipKeys = Object.keys(ko).filter((k) => k.startsWith('tooltip.'));
  assert.ok(tooltipKeys.length >= 10, 'Expected at least 10 tooltip items');

  for (const key of tooltipKeys) {
    const koTip = getTooltip(key, 'ko');
    const enTip = getTooltip(key, 'en');

    assert.ok(koTip, `KO tooltip missing for "${key}"`);
    assert.ok(enTip, `EN tooltip missing for "${key}"`);

    // Title validation
    assert.equal(typeof koTip.title, 'string', `KO tooltip "${key}" missing title`);
    assert.ok(koTip.title.trim().length > 0, `KO tooltip "${key}" title is empty`);
    assert.equal(typeof enTip.title, 'string', `EN tooltip "${key}" missing title`);
    assert.ok(enTip.title.trim().length > 0, `EN tooltip "${key}" title is empty`);

    // Body validation
    assert.equal(typeof koTip.body, 'string', `KO tooltip "${key}" missing body`);
    assert.ok(koTip.body.trim().length > 0, `KO tooltip "${key}" body is empty`);
    assert.equal(typeof enTip.body, 'string', `EN tooltip "${key}" missing body`);
    assert.ok(enTip.body.trim().length > 0, `EN tooltip "${key}" body is empty`);

    // Optional shortcut & note
    if (koTip.shortcut !== undefined) {
      assert.equal(typeof koTip.shortcut, 'string');
    }
    if (koTip.note !== undefined) {
      assert.equal(typeof koTip.note, 'string');
    }
  }
});

test('i18n: Parameter interpolation replaces variables correctly', () => {
  const koResult = translate('library.models_count', { count: 35 }, 'ko');
  assert.equal(koResult, '총 35개의 모델');

  const enResult = translate('library.models_count', { count: 35 }, 'en');
  assert.equal(enResult, '35 Models');

  const koMulti = translate('importer.import_complete_desc', { success: 12, failed: 0 }, 'ko');
  assert.equal(koMulti, '12개 모델을 성공적으로 생성했습니다. (실패: 0)');

  const enMulti = translate('importer.import_complete_desc', { success: 12, failed: 0 }, 'en');
  assert.equal(enMulti, 'Successfully imported 12 models. (Failed: 0)');
});

test('i18n: Fallback mechanism handles missing keys gracefully', () => {
  // Key missing in Korean should fall back to English if available in English
  const testKey = 'non_existent_key_12345';
  const fallbackResult = translate(testKey, undefined, 'ko');
  assert.equal(fallbackResult, testKey, 'Expected raw key returned for undefined translation');
});

test('i18n: Technical terms preserved in Korean translations and help', () => {
  const termsToVerify = ['WorkerW', 'Progman', 'MOC3', 'Steam', 'FPS', 'Live2D'];

  const allKoStrings = Object.values(ko).map((v) =>
    typeof v === 'string' ? v : `${v.title} ${v.body} ${v.note || ''}`
  ).join(' ');

  for (const term of termsToVerify) {
    assert.ok(
      allKoStrings.includes(term),
      `Expected technical term "${term}" to be preserved in Korean dictionary`
    );
  }
});
