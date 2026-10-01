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
