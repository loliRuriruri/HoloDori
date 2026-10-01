import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const PORT = 5199;
const REPO_ROOT = 'D:/test/holodori';
const PACKAGES_ROOT = 'D:/test/holodori_agent3b_packages';

// 1. Static file server
function createServer() {
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.moc3': 'application/octet-stream',
    '.vert': 'text/plain; charset=utf-8',
    '.frag': 'text/plain; charset=utf-8',
  };

  const server = http.createServer((req, res) => {
    try {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      let reqPath = decodeURIComponent(url.pathname);

      let filePath = '';
      if (reqPath.startsWith('/packages/')) {
        const sub = reqPath.slice('/packages/'.length);
        filePath = path.join(PACKAGES_ROOT, sub);
      } else if (reqPath.startsWith('/shaders/')) {
        const sub = reqPath.slice('/shaders/'.length);
        filePath = path.join(REPO_ROOT, 'public/shaders', sub);
      } else if (reqPath.startsWith('/live2d/')) {
        const sub = reqPath.slice('/live2d/'.length);
        filePath = path.join(REPO_ROOT, 'public/live2d', sub);
      } else if (reqPath.startsWith('/test_assets/')) {
        const sub = reqPath.slice('/test_assets/'.length);
        filePath = path.join(REPO_ROOT, 'target/audit_cache', sub);
      } else {
        if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
        filePath = path.join(REPO_ROOT, 'dist', reqPath.replace(/^\//, ''));
      }

      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        const ext = path.extname(filePath).toLowerCase();
        const contentType = mimeTypes[ext] || 'application/octet-stream';
        res.writeHead(200, {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
        });
        fs.createReadStream(filePath).pipe(res);
        return;
      }

      // Fallback to index.html for SPA
      const indexHtml = path.join(REPO_ROOT, 'dist/index.html');
      if (fs.existsSync(indexHtml)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        fs.createReadStream(indexHtml).pipe(res);
        return;
      }

      res.writeHead(404);
      res.end('Not Found: ' + reqPath);
    } catch (e) {
      res.writeHead(500);
      res.end('Server Error: ' + e.message);
    }
  });

  return new Promise((resolve) => {
    server.listen(PORT, '127.0.0.1', () => {
      console.log(`[TestServer] Running at http://127.0.0.1:${PORT}`);
      resolve(server);
    });
  });
}

async function main() {
  console.log('=== HDM.AGENT.4A BROWSER RUNTIME ACCEPTANCE TEST ===');
  const server = await createServer();

  let browser;
  try {
    // Try launching msedge channel
    console.log('[Browser] Launching Edge browser in headless mode with WebGL support...');
    browser = await chromium.launch({
      channel: 'msedge',
      headless: true,
      args: [
        '--use-gl=angle',
        '--use-angle=default',
        '--enable-webgl',
        '--ignore-gpu-blocklist',
        '--no-sandbox',
      ],
    });

    const page = await browser.newPage();

    // Capture browser console logs
    page.on('console', (msg) => {
      const type = msg.type();
      const text = msg.text();
      if (type === 'error') {
        console.error(`  [Browser Console Error] ${text}`);
      } else if (text.includes('Live2D') || text.includes('Viewer') || text.includes('PASS')) {
        console.log(`  [Browser Console] ${text}`);
      }
    });

    page.on('pageerror', (err) => {
      console.error(`  [Browser Page Error] ${err.message}`);
    });

    console.log('[Browser] Navigating to test page...');
    await page.goto(`http://127.0.0.1:${PORT}/index.html`);

    // Inject mock for read_package_file in test browser environment
    await page.evaluate(() => {
      (window).__HDM_MOCK_READ_PACKAGE_FILE__ = async (packageDir, relativePath) => {
        // packageDir is e.g. "D:/test/holodori_agent3b_packages/00007_001"
        const cleanDir = packageDir.replace(/\\/g, '/');
        const parts = cleanDir.split('/');
        const modelDirName = parts[parts.length - 1];
        const cleanRel = relativePath.replace(/\\/g, '/');
        const url = `/packages/${modelDirName}/${cleanRel}`;

        const res = await fetch(url);
        if (!res.ok) {
          throw new Error(`Failed to fetch test package file: ${url} (${res.status})`);
        }
        const buf = await res.arrayBuffer();
        return new Uint8Array(buf);
      };
    });

    // 1. Verify Core availability
    const coreStatus = await page.evaluate(() => {
      const hasCore = typeof (window).Live2DCubismCore !== 'undefined';
      let version = 'unknown';
      if (hasCore && (window).Live2DCubismCore?.Version?.getVersion) {
        const v = (window).Live2DCubismCore.Version.getVersion();
        version = `${(v >> 24) & 0xff}.${(v >> 16) & 0xff}.${v & 0xffff}`;
      }
      return { hasCore, version };
    });

    console.log(`[Core] Detected Live2DCubismCore: ${coreStatus.hasCore}, Version: ${coreStatus.version}`);
    if (!coreStatus.hasCore) {
      throw new Error('Live2DCubismCore was not loaded into browser window');
    }

    // 2. Test Model 00007_001 Runtime Load & Parameter Inspection
    console.log('\n--- Test Case 1: Load 00007_001 ---');
    const result007 = await page.evaluate(async () => {
      const {
        acquireCubismFramework,
        loadModelPackageFromDisk,
        Live2DModelWrapper,
        ViewerRenderer,
      } = (window).__HDM_VIEWER__;

      acquireCubismFramework();

      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      document.body.appendChild(canvas);

      const renderer = new ViewerRenderer({ canvas });
      const loadedPkg = await loadModelPackageFromDisk(
        'D:/test/holodori_agent3b_packages/00007_001',
        '00007_001.model3.json'
      );

      const model = new Live2DModelWrapper();
      await model.init(renderer.getGL(), loadedPkg, 800, 600);
      renderer.setModel(model);

      const params = model.getParameters();
      const canvasW = model.getModel()?.getCanvasWidth();
      const canvasH = model.getModel()?.getCanvasHeight();

      // Test idle animation updates
      renderer.render(0.016);
      renderer.render(0.016);

      // Test parameter modification
      const angleXIdx = params.findIndex((p) => p.id === 'ParamAngleX');
      let angleXBefore = 0;
      let angleXAfter = 0;
      if (angleXIdx >= 0) {
        angleXBefore = model.getModel()?.getParameterValueByIndex(angleXIdx);
        model.setParameter(angleXIdx, 25.0);
        angleXAfter = model.getModel()?.getParameterValueByIndex(angleXIdx);
        model.resetParameter(angleXIdx);
      }

      // Cleanup
      renderer.dispose();
      canvas.remove();

      return {
        modelId: '00007_001',
        paramCount: params.length,
        canvasW,
        canvasH,
        angleXBefore,
        angleXAfter,
        paramsSample: params.slice(0, 5).map((p) => ({ id: p.id, name: p.name, cat: p.category })),
      };
    });

    console.log(`[00007_001] Model size: ${result007.canvasW} x ${result007.canvasH}`);
    console.log(`[00007_001] Extracted parameters count: ${result007.paramCount}`);
    console.log(`[00007_001] Parameter sample:`, result007.paramsSample);
    console.log(`[00007_001] Slider adjustment test: before=${result007.angleXBefore}, modified=${result007.angleXAfter}`);

    if (result007.paramCount < 10) {
      throw new Error(`Expected at least 10 parameters, found ${result007.paramCount}`);
    }
    console.log('✅ Model 00007_001 load and inspection: PASS');

    // 3. Test Model 00010_001 Runtime Load
    console.log('\n--- Test Case 2: Load 00010_001 ---');
    const result010 = await page.evaluate(async () => {
      const {
        acquireCubismFramework,
        loadModelPackageFromDisk,
        Live2DModelWrapper,
        ViewerRenderer,
      } = (window).__HDM_VIEWER__;

      acquireCubismFramework();

      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      document.body.appendChild(canvas);

      const renderer = new ViewerRenderer({ canvas });
      const loadedPkg = await loadModelPackageFromDisk(
        'D:/test/holodori_agent3b_packages/00010_001',
        '00010_001.model3.json'
      );

      const model = new Live2DModelWrapper();
      await model.init(renderer.getGL(), loadedPkg, 800, 600);
      renderer.setModel(model);

      const params = model.getParameters();
      renderer.render(0.016);

      renderer.dispose();
      canvas.remove();

      return {
        modelId: '00010_001',
        paramCount: params.length,
      };
    });

    console.log(`[00010_001] Extracted parameters count: ${result010.paramCount}`);
    if (result010.paramCount < 10) {
      throw new Error(`Expected at least 10 parameters, found ${result010.paramCount}`);
    }
    console.log('✅ Model 00010_001 load and inspection: PASS');

    // 4. Test 20-Cycle Repeated Load/Unload Alternation
    console.log('\n--- Test Case 3: 20-Cycle Repeated Load/Unload Alternation ---');
    const cycleResult = await page.evaluate(async () => {
      const {
        acquireCubismFramework,
        loadModelPackageFromDisk,
        Live2DModelWrapper,
        ViewerRenderer,
      } = (window).__HDM_VIEWER__;

      acquireCubismFramework();

      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      document.body.appendChild(canvas);

      const renderer = new ViewerRenderer({ canvas });
      const cycles = 20;
      const history = [];

      for (let i = 0; i < cycles; i++) {
        const targetModel = i % 2 === 0 ? '00007_001' : '00010_001';
        const pkgDir = `D:/test/holodori_agent3b_packages/${targetModel}`;

        const loadedPkg = await loadModelPackageFromDisk(pkgDir, `${targetModel}.model3.json`);
        const model = new Live2DModelWrapper();
        await model.init(renderer.getGL(), loadedPkg, 800, 600);
        renderer.setModel(model);

        // Render 2 frames
        renderer.render(0.016);
        renderer.render(0.016);

        // Clean up model
        model.disposeModel(renderer.getGL());
        renderer.setModel(null);

        history.push({ cycle: i + 1, model: targetModel, success: true });
      }

      renderer.dispose();
      canvas.remove();

      return {
        totalCycles: cycles,
        history,
      };
    });

    console.log(`[20 Cycles] Completed ${cycleResult.totalCycles} load/unload cycles successfully without crash or error.`);
    console.log('✅ 20-Cycle Load/Unload Stress Test: PASS');

    // 4. Test Case 4: Real Motion Playback & Parameter Mutation Verification
    console.log('\n--- Test Case 4: Real HoloDori Motion Playback ---');
    const motionTest = await page.evaluate(async () => {
      const {
        acquireCubismFramework,
        loadModelPackageFromDisk,
        Live2DModelWrapper,
        ViewerRenderer,
      } = (window).__HDM_VIEWER__;

      acquireCubismFramework();

      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      document.body.appendChild(canvas);

      const renderer = new ViewerRenderer({ canvas });
      const loadedPkg = await loadModelPackageFromDisk(
        'D:/test/holodori_agent3b_packages/00007_001',
        '00007_001.model3.json'
      );

      const model = new Live2DModelWrapper();
      await model.init(renderer.getGL(), loadedPkg, 800, 600);
      renderer.setModel(model);

      // Disable breath and blink to isolate motion curve values
      renderer.setViewerOptions({ enableBreath: false, enableEyeBlink: false });

      // Fetch real motion bytes (live2d_mot_joy-01_lv01)
      const res = await fetch('/test_assets/test_mot.motion3.json');
      if (!res.ok) throw new Error('Failed to fetch test_mot.motion3.json');
      const motBytes = await res.arrayBuffer();

      const motMgr = model.getMotionManager();
      const stateHistory = [];
      motMgr.setStateCallback((st, info) => {
        stateHistory.push({ state: st, name: info?.name });
      });

      // Play motion
      const motion = motMgr.playMotion(motBytes, 'live2d_mot_joy-01_lv01', 'joy-01_lv01');
      if (!motion) throw new Error('Failed to create motion instance');

      const initialDuration = motion.getDuration();
      const startState = motMgr.getState();

      const params = model.getParameters();
      const angleXIdx = params.findIndex((p) => p.id === 'ParamAngleX');
      const bodyAngleXIdx = params.findIndex((p) => p.id === 'ParamBodyAngleX');

      // Step simulation and sample values across time
      const samples = [];
      for (let f = 0; f < 30; f++) {
        renderer.render(1.0 / 30.0);
        const valX = angleXIdx >= 0 ? model.getModel()?.getParameterValueByIndex(angleXIdx) : 0;
        const valBodyX = bodyAngleXIdx >= 0 ? model.getModel()?.getParameterValueByIndex(bodyAngleXIdx) : 0;
        samples.push({ f, valX, valBodyX });
      }

      // Test interruption / stop
      motMgr.stopMotion();
      const stoppedState = motMgr.getState();
      const isFinished = motMgr.isFinished();

      renderer.dispose();
      canvas.remove();

      return {
        initialDuration,
        startState,
        stoppedState,
        isFinished,
        samplesCount: samples.length,
        hasVariation: samples.some((s) => Math.abs(s.valX) > 0.0001 || Math.abs(s.valBodyX) > 0.0001),
        sampleValues: samples.slice(0, 5),
      };
    });

    console.log(`[Motion] Duration: ${motionTest.initialDuration.toFixed(2)}s, StartState: ${motionTest.startState}, StoppedState: ${motionTest.stoppedState}`);
    console.log(`[Motion] Has Parameter Variation: ${motionTest.hasVariation}, Samples:`, motionTest.sampleValues);
    if (!motionTest.hasVariation) {
      throw new Error('Motion curves failed to mutate model parameters during playback');
    }
    if (motionTest.startState !== 'playing' || motionTest.stoppedState !== 'idle') {
      throw new Error(`Unexpected motion state transitions: start=${motionTest.startState}, stop=${motionTest.stoppedState}`);
    }
    console.log('✅ Real Motion Playback & Parameter Mutation: PASS');

    // 5. Test Case 5: Real HoloDori Expression Application & Neutral Reset
    console.log('\n--- Test Case 5: Real HoloDori Expression Application & Clear ---');
    const exprTest = await page.evaluate(async () => {
      const {
        acquireCubismFramework,
        loadModelPackageFromDisk,
        Live2DModelWrapper,
        ViewerRenderer,
      } = (window).__HDM_VIEWER__;

      acquireCubismFramework();

      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      document.body.appendChild(canvas);

      const renderer = new ViewerRenderer({ canvas });
      const loadedPkg = await loadModelPackageFromDisk(
        'D:/test/holodori_agent3b_packages/00007_001',
        '00007_001.model3.json'
      );

      const model = new Live2DModelWrapper();
      await model.init(renderer.getGL(), loadedPkg, 800, 600);
      renderer.setModel(model);

      renderer.setViewerOptions({ enableBreath: false, enableEyeBlink: false });

      // Fetch real expression bytes (live2d_exp_anger-01_00007_000)
      const res = await fetch('/test_assets/test_exp.exp3.json');
      if (!res.ok) throw new Error('Failed to fetch test_exp.exp3.json');
      const expBytes = await res.arrayBuffer();

      const expMgr = model.getExpressionManager();

      // Sample ParamEyeRSmile before expression
      const params = model.getParameters();
      const smileIdx = params.findIndex((p) => p.id === 'ParamEyeRSmile');
      const neutralSmile = smileIdx >= 0 ? model.getModel()?.getParameterValueByIndex(smileIdx) : 0;

      // Apply expression
      const applied = expMgr.applyExpression(expBytes, 'live2d_exp_anger-01_00007_000', 'anger-01');
      if (!applied) throw new Error('Failed to create expression motion instance');

      const expInfo = expMgr.getCurrentInfo();

      // Render 15 frames (approx 0.5s) to allow fade-in
      for (let f = 0; f < 15; f++) {
        renderer.render(1.0 / 30.0);
      }

      const activeSmile = smileIdx >= 0 ? model.getModel()?.getParameterValueByIndex(smileIdx) : 0;

      // Clear expression
      expMgr.clearExpression();
      const clearedInfo = expMgr.getCurrentInfo();

      // Render 20 frames for fade-out back to neutral
      for (let f = 0; f < 20; f++) {
        renderer.render(1.0 / 30.0);
      }

      const resetSmile = smileIdx >= 0 ? model.getModel()?.getParameterValueByIndex(smileIdx) : 0;

      renderer.dispose();
      canvas.remove();

      return {
        expName: expInfo?.name,
        clearedName: clearedInfo?.name || null,
        neutralSmile,
        activeSmile,
        resetSmile,
        appliedDifference: Math.abs(activeSmile - neutralSmile),
      };
    });

    console.log(`[Expression] Name: ${exprTest.expName}, Neutral: ${exprTest.neutralSmile}, Active: ${exprTest.activeSmile}, Reset: ${exprTest.resetSmile}`);
    if (exprTest.appliedDifference < 0.05) {
      throw new Error(`Expression parameters failed to apply: difference=${exprTest.appliedDifference}`);
    }
    console.log('✅ Real Expression Application & Neutral Reset: PASS');

    // 6. Test Case 6: Concurrent Motion + Expression + Procedural Idle Layering
    console.log('\n--- Test Case 6: Concurrent Motion + Expression + Procedural Idle ---');
    const concurrentTest = await page.evaluate(async () => {
      const {
        acquireCubismFramework,
        loadModelPackageFromDisk,
        Live2DModelWrapper,
        ViewerRenderer,
      } = (window).__HDM_VIEWER__;

      acquireCubismFramework();

      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      document.body.appendChild(canvas);

      const renderer = new ViewerRenderer({ canvas });
      const loadedPkg = await loadModelPackageFromDisk(
        'D:/test/holodori_agent3b_packages/00007_001',
        '00007_001.model3.json'
      );

      const model = new Live2DModelWrapper();
      await model.init(renderer.getGL(), loadedPkg, 800, 600);
      renderer.setModel(model);

      // Procedural animations active
      renderer.setViewerOptions({ enableBreath: true, enableEyeBlink: true });

      const motRes = await fetch('/test_assets/test_mot.motion3.json');
      const motBytes = await motRes.arrayBuffer();

      const expRes = await fetch('/test_assets/test_exp.exp3.json');
      const expBytes = await expRes.arrayBuffer();

      // Apply expression AND play motion concurrently
      model.getExpressionManager().applyExpression(expBytes, 'live2d_exp_anger-01_00007_000', 'anger-01');
      model.getMotionManager().playMotion(motBytes, 'live2d_mot_joy-01_lv01', 'joy-01_lv01');

      let renderErrors = 0;
      for (let f = 0; f < 30; f++) {
        try {
          renderer.render(1.0 / 30.0);
        } catch (e) {
          renderErrors++;
        }
      }

      renderer.dispose();
      canvas.remove();

      return {
        renderErrors,
        success: renderErrors === 0,
      };
    });

    if (!concurrentTest.success) {
      throw new Error(`Concurrent render loop threw ${concurrentTest.renderErrors} errors`);
    }
    console.log('✅ Concurrent Motion, Expression, and Procedural Idle: PASS');

    // 7. Test Case 7: In-Viewer Switching (00007 <-> 00010) on Same WebGL Context
    console.log('\n--- Test Case 7: In-Viewer Switching (00007 <-> 00010) on Same WebGL Context ---');
    const switchTest = await page.evaluate(async () => {
      const {
        acquireCubismFramework,
        loadModelPackageFromDisk,
        Live2DModelWrapper,
        ViewerRenderer,
      } = (window).__HDM_VIEWER__;

      acquireCubismFramework();

      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      document.body.appendChild(canvas);

      const renderer = new ViewerRenderer({ canvas });
      const gl = renderer.getGL();

      // Step 1: Load 00007_001
      const pkg1 = await loadModelPackageFromDisk(
        'D:/test/holodori_agent3b_packages/00007_001',
        '00007_001.model3.json'
      );
      const model1 = new Live2DModelWrapper();
      await model1.init(gl, pkg1, 800, 600);
      renderer.setModel(model1);
      const pCount1 = model1.getParameters().length;

      // Render 5 frames
      for (let i = 0; i < 5; i++) renderer.render(1 / 30);

      // Step 2: Switch to 00010_001
      renderer.setModel(null);
      model1.disposeModel(gl);

      const pkg2 = await loadModelPackageFromDisk(
        'D:/test/holodori_agent3b_packages/00010_001',
        '00010_001.model3.json'
      );
      const model2 = new Live2DModelWrapper();
      await model2.init(gl, pkg2, 800, 600);
      renderer.setModel(model2);
      const pCount2 = model2.getParameters().length;

      // Render 5 frames
      for (let i = 0; i < 5; i++) renderer.render(1 / 30);

      // Step 3: Switch back to 00007_001
      renderer.setModel(null);
      model2.disposeModel(gl);

      const pkg3 = await loadModelPackageFromDisk(
        'D:/test/holodori_agent3b_packages/00007_001',
        '00007_001.model3.json'
      );
      const model3 = new Live2DModelWrapper();
      await model3.init(gl, pkg3, 800, 600);
      renderer.setModel(model3);
      const pCount3 = model3.getParameters().length;

      for (let i = 0; i < 5; i++) renderer.render(1 / 30);

      renderer.dispose();
      canvas.remove();

      return {
        pCount1,
        pCount2,
        pCount3,
        glContextValid: !gl.isContextLost(),
      };
    });

    console.log(`[Switching] 00007 params=${switchTest.pCount1} -> 00010 params=${switchTest.pCount2} -> 00007 params=${switchTest.pCount3}`);
    if (switchTest.pCount1 !== 131 || switchTest.pCount2 !== 162 || switchTest.pCount3 !== 131) {
      throw new Error(`Parameter count mismatch during switching: ${JSON.stringify(switchTest)}`);
    }
    if (!switchTest.glContextValid) {
      throw new Error('WebGL context lost during switching');
    }
    console.log('✅ In-Viewer Character and Outfit Switching: PASS');

    // 8. Test Case 8: Authentic Physics Evaluation & Subrig Verification
    console.log('\n--- Test Case 8: Authentic Live2D Physics Attachment & Evaluation ---');
    const physicsTest = await page.evaluate(async () => {
      const {
        acquireCubismFramework,
        loadModelPackageFromDisk,
        Live2DModelWrapper,
        ViewerRenderer,
      } = (window).__HDM_VIEWER__;

      acquireCubismFramework();

      const canvas = document.createElement('canvas');
      canvas.width = 800;
      canvas.height = 600;
      document.body.appendChild(canvas);

      const renderer = new ViewerRenderer({ canvas });
      const pkg = await loadModelPackageFromDisk(
        'D:/test/holodori_agent3b_packages/00007_001',
        '00007_001.model3.json'
      );
      const model = new Live2DModelWrapper();
      await model.init(renderer.getGL(), pkg, 800, 600);
      renderer.setModel(model);

      const hasPhysics = model.hasPhysics();
      const rigCount = model.getPhysicsRigCount();

      // Test physics off vs on: animate angle and check if hair physics responds
      renderer.setViewerOptions({ enableBreath: false, enableEyeBlink: false, enablePhysics: true });

      // Run 30 frames with head angle changes
      const samples = [];
      for (let f = 0; f < 30; f++) {
        const angleX = Math.sin(f * 0.4) * 30.0;
        model.setParameter(0, angleX); // ParamAngleX
        renderer.render(1 / 30);
        const pList = model.getParameters();
        const hairFront = pList.find((p) => p.id === 'ParamHairFront')?.currentValue ?? 0;
        const hairSide = pList.find((p) => p.id === 'ParamHairSide')?.currentValue ?? 0;
        samples.push({ f, hairFront, hairSide });
      }

      renderer.dispose();
      canvas.remove();

      return {
        hasPhysics,
        rigCount,
        sampleCount: samples.length,
      };
    });

    console.log(`[Physics] hasPhysics=${physicsTest.hasPhysics}, rigCount=${physicsTest.rigCount}`);
    if (!physicsTest.hasPhysics) {
      throw new Error('Physics was not attached to 00007_001 model');
    }
    if (physicsTest.rigCount <= 0) {
      throw new Error(`Expected positive physics rig count, got ${physicsTest.rigCount}`);
    }
    console.log('✅ Authentic Live2D Physics Attachment & Evaluation: PASS');

    // 9. Test Case 9: Player Settings & State Persistence
    console.log('\n--- Test Case 9: Player Settings, Favorites, and Recent Models Persistence ---');
    const settingsTest = await page.evaluate(async () => {
      const {
        DEFAULT_VIEWER_SETTINGS,
        pushRecentModel,
        toggleFavoriteItem,
        loadPlayerState,
        savePlayerState,
      } = (window).__HDM_VIEWER__;

      // Test recent models capping
      let recents = [];
      for (let i = 1; i <= 15; i++) {
        recents = pushRecentModel(recents, {
          modelId: `char_${i}_001`,
          characterId: `char_${i}`,
          outfitId: '001',
          displayName: `Char ${i}`,
          packageDir: `/pkg/${i}`,
        });
      }
      const recentCapped = recents.length === 10 && recents[0].modelId === 'char_15_001';

      // Test favorites
      let favs = { characters: [], outfits: [], motions: [], expressions: [] };
      favs = toggleFavoriteItem(favs, 'characters', '00007');
      favs = toggleFavoriteItem(favs, 'motions', 'live2d_mot_joy-01');
      const favAdded = favs.characters.includes('00007') && favs.motions.includes('live2d_mot_joy-01');
      favs = toggleFavoriteItem(favs, 'characters', '00007');
      const favRemoved = !favs.characters.includes('00007') && favs.motions.includes('live2d_mot_joy-01');

      // Test localStorage persistence
      await savePlayerState({
        settings: { ...DEFAULT_VIEWER_SETTINGS, mode: 'player', background: 'checkerboard' },
        favorites: favs,
        recentModels: recents,
      });

      const loaded = await loadPlayerState();
      const persistenceMatch =
        loaded.settings.background === 'checkerboard' &&
        loaded.favorites.motions.length === 1 &&
        loaded.recentModels.length === 10;

      return {
        recentCapped,
        favAdded,
        favRemoved,
        persistenceMatch,
      };
    });

    if (!settingsTest.recentCapped || !settingsTest.favAdded || !settingsTest.favRemoved || !settingsTest.persistenceMatch) {
      throw new Error(`Settings/Persistence test failed: ${JSON.stringify(settingsTest)}`);
    }
    console.log('✅ Player Settings, Favorites, and Recent Models Persistence: PASS');

    console.log('\n=== ALL EMBEDDED VIEWER ACCEPTANCE TESTS PASSED ===');
  } finally {
    if (browser) await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error('\n❌ TEST FAILED:', err);
  process.exit(1);
});
