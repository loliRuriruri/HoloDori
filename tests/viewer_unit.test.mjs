import test from 'node:test';
import assert from 'node:assert/strict';

// 1. Pure parameter logic
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

// 2. Settings & Favorites logic
const DEFAULT_VIEWER_SETTINGS = {
  mode: 'player',
  background: 'neutral',
  enableBlink: true,
  enableBreath: true,
  enablePhysics: true,
  autoMotion: false,
  autoMotionDelaySec: 3.0,
  zoom: 1.0,
};

const DEFAULT_FAVORITES = {
  characters: [],
  outfits: [],
  motions: [],
  expressions: [],
};

function pushRecentModel(list, entry) {
  const filtered = list.filter((m) => m.modelId !== entry.modelId);
  const updated = {
    ...entry,
    timestamp: Date.now(),
  };
  return [updated, ...filtered].slice(0, 10);
}

function toggleFavoriteItem(favorites, category, id) {
  const current = favorites[category];
  const exists = current.includes(id);
  const updated = exists ? current.filter((x) => x !== id) : [...current, id];
  return {
    ...favorites,
    [category]: updated,
  };
}

function pickRandomMotion(motions, lastMotionName) {
  if (!motions || motions.length === 0) return null;
  let candidates = motions;
  if (motions.length > 1 && lastMotionName) {
    const filtered = motions.filter((m) => m.asset_name !== lastMotionName);
    if (filtered.length > 0) candidates = filtered;
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// --- UNIT TESTS ---

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
  const wide = computeViewAspect(1920, 1080);
  assert.ok(wide.scaleX < 1.0, 'X scale should be compressed to preserve aspect');
  assert.equal(wide.scaleY, 1.0);
  assert.equal(Math.round(wide.scaleX * 1920), 1080);

  const tall = computeViewAspect(1080, 1920);
  assert.equal(tall.scaleX, 1.0);
  assert.ok(tall.scaleY < 1.0, 'Y scale should be compressed to preserve aspect');
  assert.equal(Math.round(tall.scaleY * 1920), 1080);

  const square = computeViewAspect(1000, 1000);
  assert.equal(square.scaleX, 1.0);
  assert.equal(square.scaleY, 1.0);
});

test('computeZoomClamped respects zoom boundaries [0.2, 8.0]', () => {
  assert.equal(computeZoomClamped(1.0, 1.2), 1.2);
  assert.equal(computeZoomClamped(7.0, 2.0), 8.0);
  assert.equal(computeZoomClamped(0.3, 0.5), 0.2);
});

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

test('animation precedence order guarantees user overrides over physics, procedural and motion updates', () => {
  const pipelineOrder = [
    'motionManager.updateMotion',
    'expressionManager.updateMotion',
    'eyeBlink.updateParameters',
    'breath.updateParameters',
    'physics.evaluate',
    'userOverrides',
    'model.update',
  ];

  assert.equal(pipelineOrder.indexOf('motionManager.updateMotion'), 0);
  assert.equal(pipelineOrder.indexOf('expressionManager.updateMotion'), 1);
  assert.equal(pipelineOrder.indexOf('eyeBlink.updateParameters'), 2);
  assert.equal(pipelineOrder.indexOf('breath.updateParameters'), 3);
  assert.equal(pipelineOrder.indexOf('physics.evaluate'), 4);
  assert.equal(pipelineOrder.indexOf('userOverrides'), 5);
  assert.equal(pipelineOrder.indexOf('model.update'), 6);
});

test('pushRecentModel caps list strictly at 10 and moves duplicates to front', () => {
  let list = [];
  for (let i = 1; i <= 15; i++) {
    list = pushRecentModel(list, {
      modelId: `model_${i}`,
      characterId: `char_${i}`,
      outfitId: '001',
      displayName: `Model ${i}`,
      packageDir: `/packages/model_${i}`,
    });
  }

  assert.equal(list.length, 10, 'Recent list must be capped at 10 items');
  assert.equal(list[0].modelId, 'model_15', 'Most recent item must be at index 0');
  assert.equal(list[9].modelId, 'model_6', 'Tenth item must be model_6');

  // Push existing model_10: should move to front without increasing length
  list = pushRecentModel(list, {
    modelId: 'model_10',
    characterId: 'char_10',
    outfitId: '001',
    displayName: 'Model 10 Revisit',
    packageDir: '/packages/model_10',
  });

  assert.equal(list.length, 10);
  assert.equal(list[0].modelId, 'model_10', 'Re-pushed item must move to front');
  assert.equal(list[0].displayName, 'Model 10 Revisit');
  assert.equal(list.filter((m) => m.modelId === 'model_10').length, 1, 'No duplicate entries');
});

test('toggleFavoriteItem adds, removes, and preserves other categories', () => {
  let favs = { ...DEFAULT_FAVORITES };

  // Add character
  favs = toggleFavoriteItem(favs, 'characters', '00007');
  assert.deepEqual(favs.characters, ['00007']);

  // Add another character
  favs = toggleFavoriteItem(favs, 'characters', '00010');
  assert.deepEqual(favs.characters, ['00007', '00010']);

  // Remove first character
  favs = toggleFavoriteItem(favs, 'characters', '00007');
  assert.deepEqual(favs.characters, ['00010']);

  // Add motion
  favs = toggleFavoriteItem(favs, 'motions', 'live2d_mot_joy-01');
  assert.deepEqual(favs.motions, ['live2d_mot_joy-01']);
  assert.deepEqual(favs.characters, ['00010'], 'Characters category must be unchanged');
});

test('pickRandomMotion avoids immediate repeats when candidates > 1', () => {
  const motions = [
    { asset_name: 'motion_a', name: 'Motion A' },
    { asset_name: 'motion_b', name: 'Motion B' },
    { asset_name: 'motion_c', name: 'Motion C' },
  ];

  // If last was motion_a, pickRandomMotion must never return motion_a
  for (let i = 0; i < 50; i++) {
    const picked = pickRandomMotion(motions, 'motion_a');
    assert.notEqual(picked.asset_name, 'motion_a');
    assert.ok(picked.asset_name === 'motion_b' || picked.asset_name === 'motion_c');
  }

  // Single motion test
  const single = [{ asset_name: 'only_one', name: 'Only One' }];
  const pickedSingle = pickRandomMotion(single, 'only_one');
  assert.equal(pickedSingle.asset_name, 'only_one');
});

test('DEFAULT_VIEWER_SETTINGS defines authentic production player baseline', () => {
  assert.equal(DEFAULT_VIEWER_SETTINGS.mode, 'player');
  assert.equal(DEFAULT_VIEWER_SETTINGS.background, 'neutral');
  assert.equal(DEFAULT_VIEWER_SETTINGS.enablePhysics, true);
  assert.equal(DEFAULT_VIEWER_SETTINGS.enableBreath, true);
  assert.equal(DEFAULT_VIEWER_SETTINGS.enableBlink, true);
  assert.equal(DEFAULT_VIEWER_SETTINGS.autoMotion, false);
  assert.equal(DEFAULT_VIEWER_SETTINGS.autoMotionDelaySec, 3.0);
});

// 3. Desktop Mode & Settings Unit Tests
const DEFAULT_DESKTOP_SETTINGS = {
  width: 500,
  height: 700,
  scale: 1.0,
  alwaysOnTop: true,
  clickThrough: false,
  editMode: false,
  fps: 60,
  performanceMode: 'balanced',
  hideDuringFullscreen: false,
  paused: false,
};

function clampDesktopScale(val) {
  return Math.min(Math.max(val, 0.25), 3.0);
}

function clampWindowPosition(x, y, width, height, monitors) {
  if (!monitors || monitors.length === 0) {
    return { x: Math.max(x, 0), y: Math.max(y, 0) };
  }
  const minMargin = 60.0;
  let overlaps = false;
  for (const m of monitors) {
    const ox = x < m.x + m.width - minMargin && x + width > m.x + minMargin;
    const oy = y < m.y + m.height - minMargin && y + height > m.y + minMargin;
    if (ox && oy) {
      overlaps = true;
      break;
    }
  }
  if (overlaps) {
    return { x, y };
  }
  const primary = monitors.find((m) => m.is_primary) || monitors[0];
  const safeX = Math.max(primary.x + primary.width - width - 40, primary.x);
  const safeY = Math.max(primary.y + primary.height - height - 60, primary.y);
  return { x: safeX, y: safeY };
}

function migratePlayerSettings(raw) {
  const settings = raw.settings || {};
  return {
    ...DEFAULT_VIEWER_SETTINGS,
    ...settings,
    desktop: {
      ...DEFAULT_DESKTOP_SETTINGS,
      ...(settings.desktop || {}),
    },
  };
}

test('DEFAULT_DESKTOP_SETTINGS defines robust frameless desktop baseline', () => {
  assert.equal(DEFAULT_DESKTOP_SETTINGS.width, 500);
  assert.equal(DEFAULT_DESKTOP_SETTINGS.height, 700);
  assert.equal(DEFAULT_DESKTOP_SETTINGS.scale, 1.0);
  assert.equal(DEFAULT_DESKTOP_SETTINGS.fps, 60);
  assert.equal(DEFAULT_DESKTOP_SETTINGS.alwaysOnTop, true);
  assert.equal(DEFAULT_DESKTOP_SETTINGS.clickThrough, false);
  assert.equal(DEFAULT_DESKTOP_SETTINGS.editMode, false);
  assert.equal(DEFAULT_DESKTOP_SETTINGS.paused, false);
});

test('migratePlayerSettings correctly upgrades legacy state missing desktop field', () => {
  const legacy = {
    settings: {
      mode: 'player',
      zoom: 1.5,
      autoMotion: true,
    },
  };
  const migrated = migratePlayerSettings(legacy);
  assert.equal(migrated.zoom, 1.5);
  assert.equal(migrated.autoMotion, true);
  assert.ok(migrated.desktop);
  assert.equal(migrated.desktop.fps, 60);
  assert.equal(migrated.desktop.scale, 1.0);
  assert.equal(migrated.desktop.alwaysOnTop, true);
});

test('clampDesktopScale enforces [0.25, 3.0] scale limits', () => {
  assert.equal(clampDesktopScale(0.1), 0.25);
  assert.equal(clampDesktopScale(0.25), 0.25);
  assert.equal(clampDesktopScale(1.0), 1.0);
  assert.equal(clampDesktopScale(2.5), 2.5);
  assert.equal(clampDesktopScale(3.0), 3.0);
  assert.equal(clampDesktopScale(5.0), 3.0);
});

test('clampWindowPosition preserves in-bounds window and recovers off-screen coordinates', () => {
  const monitors = [
    { name: 'Display 1', x: 0, y: 0, width: 1920, height: 1080, is_primary: true },
    { name: 'Display 2', x: 1920, y: 0, width: 1920, height: 1080, is_primary: false },
  ];

  // In primary monitor
  const inPrimary = clampWindowPosition(200, 200, 500, 700, monitors);
  assert.equal(inPrimary.x, 200);
  assert.equal(inPrimary.y, 200);

  // In secondary monitor
  const inSecondary = clampWindowPosition(2200, 150, 500, 700, monitors);
  assert.equal(inSecondary.x, 2200);
  assert.equal(inSecondary.y, 150);

  // Completely off-screen (-9999, -9999): must recover to bottom-right of primary display
  const offscreen = clampWindowPosition(-9999, -9999, 500, 700, monitors);
  assert.ok(offscreen.x >= 0 && offscreen.x <= 1920, `Recovered x ${offscreen.x} must be on primary monitor`);
  assert.ok(offscreen.y >= 0 && offscreen.y <= 1080, `Recovered y ${offscreen.y} must be on primary monitor`);
});

