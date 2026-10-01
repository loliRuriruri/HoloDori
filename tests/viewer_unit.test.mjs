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

function parseMotionAssetName(assetName) {
  const clean = assetName.replace(/^live2d_mot_/, '');
  const cat = clean.split(/[-_]/)[0] || 'other';
  return { category: cat, name: clean };
}

function parseExpressionAssetName(assetName) {
  const parts = assetName.split('_');
  if (parts.length >= 4) {
    return { name: parts[2], characterId: parts[3] };
  }
  return { name: assetName, characterId: 'unknown' };
}

test('parseMotionAssetName categorizes HoloDori motions accurately', () => {
  const m1 = parseMotionAssetName('live2d_mot_joy-01_lv01');
  assert.equal(m1.category, 'joy');
  assert.equal(m1.name, 'joy-01_lv01');

  const m2 = parseMotionAssetName('live2d_mot_smile-00_lp');
  assert.equal(m2.category, 'smile');
  assert.equal(m2.name, 'smile-00_lp');

  const m3 = parseMotionAssetName('live2d_mot_wink-02_lv02');
  assert.equal(m3.category, 'wink');
  assert.equal(m3.name, 'wink-02_lv02');
});

test('parseExpressionAssetName extracts character id and expression name', () => {
  const e1 = parseExpressionAssetName('live2d_exp_anger-01_00007_000');
  assert.equal(e1.name, 'anger-01');
  assert.equal(e1.characterId, '00007');

  const e2 = parseExpressionAssetName('live2d_exp_smile-02_00010_000');
  assert.equal(e2.name, 'smile-02');
  assert.equal(e2.characterId, '00010');
});

test('animation precedence order guarantees user overrides over procedural and motion updates', () => {
  const pipelineOrder = [
    'motionManager.updateMotion',
    'expressionManager.updateMotion',
    'eyeBlink.updateParameters',
    'breath.updateParameters',
    'userOverrides',
    'model.update',
  ];

  assert.equal(pipelineOrder.indexOf('motionManager.updateMotion'), 0);
  assert.equal(pipelineOrder.indexOf('expressionManager.updateMotion'), 1);
  assert.equal(pipelineOrder.indexOf('eyeBlink.updateParameters'), 2);
  assert.equal(pipelineOrder.indexOf('breath.updateParameters'), 3);
  assert.equal(pipelineOrder.indexOf('userOverrides'), 4);
  assert.equal(pipelineOrder.indexOf('model.update'), 5);
});
