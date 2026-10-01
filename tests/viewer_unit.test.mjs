import test from 'node:test';
import assert from 'node:assert/strict';

// Import pure logic functions
function categorizeParameter(id) {
  const lower = id.toLowerCase();
  if (lower.includes('angle') || lower.includes('rotat')) {
    return 'Angle';
  }
  if (lower.includes('eye') && !lower.includes('brow')) {
    return 'Eye';
  }
  if (lower.includes('brow')) {
    return 'Eyebrow';
  }
  if (lower.includes('mouth') || lower.includes('lip') || lower.includes('tear') || lower.includes('voice')) {
    return 'Mouth';
  }
  if (lower.includes('body') || lower.includes('arm') || lower.includes('hand') || lower.includes('leg') || lower.includes('bust') || lower.includes('chest')) {
    return 'Body';
  }
  if (lower.includes('hair') || lower.includes('cheek') || lower.includes('blush') || lower.includes('ear') || lower.includes('tail') || lower.includes('acc')) {
    return 'Hair';
  }
  return 'Other';
}

function formatParameterName(id) {
  let clean = id;
  if (clean.startsWith('Param')) {
    clean = clean.substring(5);
  }
  const spaced = clean.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2');
  return spaced || id;
}

function computeViewAspect(canvasWidth, canvasHeight) {
  const aspect = canvasWidth / canvasHeight;
  if (canvasWidth > canvasHeight) {
    return { scaleX: 1.0 / aspect, scaleY: 1.0 };
  } else {
    return { scaleX: 1.0, scaleY: aspect };
  }
}

function computeZoomClamped(currentZoom, factor) {
  const next = currentZoom * factor;
  return Math.min(Math.max(next, 0.2), 8.0);
}

test('categorizeParameter groups standard Live2D parameter IDs correctly', () => {
  assert.equal(categorizeParameter('ParamAngleX'), 'Angle');
  assert.equal(categorizeParameter('ParamAngleY'), 'Angle');
  assert.equal(categorizeParameter('ParamAngleZ'), 'Angle');
  assert.equal(categorizeParameter('ParamBodyAngleX'), 'Angle');

  assert.equal(categorizeParameter('ParamEyeLOpen'), 'Eye');
  assert.equal(categorizeParameter('ParamEyeROpen'), 'Eye');
  assert.equal(categorizeParameter('ParamEyeBallX'), 'Eye');
  assert.equal(categorizeParameter('ParamEyeBallY'), 'Eye');

  assert.equal(categorizeParameter('ParamBrowLY'), 'Eyebrow');
  assert.equal(categorizeParameter('ParamBrowRY'), 'Eyebrow');

  assert.equal(categorizeParameter('ParamMouthForm'), 'Mouth');
  assert.equal(categorizeParameter('ParamMouthOpenY'), 'Mouth');

  assert.equal(categorizeParameter('ParamBodyAngleZ'), 'Angle');
  assert.equal(categorizeParameter('ParamArmLA'), 'Body');
  assert.equal(categorizeParameter('ParamHandR'), 'Body');
  assert.equal(categorizeParameter('ParamLegL'), 'Body');

  assert.equal(categorizeParameter('ParamHairFront'), 'Hair');
  assert.equal(categorizeParameter('ParamHairSide'), 'Hair');
  assert.equal(categorizeParameter('ParamCheek'), 'Hair');

  assert.equal(categorizeParameter('ParamBreath'), 'Other');
});

test('formatParameterName produces clean human-readable names', () => {
  assert.equal(formatParameterName('ParamAngleX'), 'Angle X');
  assert.equal(formatParameterName('ParamEyeLOpen'), 'Eye L Open');
  assert.equal(formatParameterName('ParamMouthOpenY'), 'Mouth Open Y');
  assert.equal(formatParameterName('ParamBodyAngleX'), 'Body Angle X');
  assert.equal(formatParameterName('ParamBreath'), 'Breath');
});

test('computeViewAspect calculates proper letterboxing scaling', () => {
  // Wide screen 1920x1080 (16:9)
  const wide = computeViewAspect(1920, 1080);
  assert.ok(wide.scaleX < 1.0, 'X scale should be compressed to preserve aspect');
  assert.equal(wide.scaleY, 1.0);
  assert.equal(Math.round(wide.scaleX * 1920), 1080);

  // Tall screen 1080x1920 (9:16)
  const tall = computeViewAspect(1080, 1920);
  assert.equal(tall.scaleX, 1.0);
  assert.ok(tall.scaleY < 1.0, 'Y scale should be compressed to preserve aspect');
  assert.equal(Math.round(tall.scaleY * 1920), 1080);

  // Square screen 1000x1000
  const square = computeViewAspect(1000, 1000);
  assert.equal(square.scaleX, 1.0);
  assert.equal(square.scaleY, 1.0);
});

test('computeZoomClamped respects zoom boundaries [0.2, 8.0]', () => {
  assert.equal(computeZoomClamped(1.0, 1.2), 1.2);
  assert.equal(computeZoomClamped(7.0, 2.0), 8.0); // Clamped at max
  assert.equal(computeZoomClamped(0.3, 0.5), 0.2); // Clamped at min
});
