import { CubismUserModel } from './framework/model/cubismusermodel';
import { CubismFramework } from './framework/live2dcubismframework';
import { CubismMatrix44 } from './framework/math/cubismmatrix44';
import { CubismModelMatrix } from './framework/math/cubismmodelmatrix';
import { CubismEyeBlink } from './framework/effect/cubismeyeblink';
import { CubismBreath, BreathParameterData } from './framework/effect/cubismbreath';
import { CubismIdHandle } from './framework/id/cubismid';
import { LoadedModelPackage } from './resources';
import { ViewerOptions, ModelParameterInfo } from '../types';
import { extractParameters } from './parameters';
import { HoloDoriMotionManager } from './motion';
import { HoloDoriExpressionManager } from './expression';

export class Live2DModelWrapper extends CubismUserModel {
  private _glTextures: WebGLTexture[] = [];
  private _userOverrides: Map<number, number> = new Map();
  private _loadedPackage: LoadedModelPackage | null = null;
  private _holoMotion: HoloDoriMotionManager;
  private _holoExpression: HoloDoriExpressionManager;

  constructor() {
    super();
    this._modelMatrix = new CubismModelMatrix();
    this._holoMotion = new HoloDoriMotionManager(this._motionManager);
    this._holoExpression = new HoloDoriExpressionManager(this._expressionManager);
  }

  public getMotionManager(): HoloDoriMotionManager {
    return this._holoMotion;
  }

  public getExpressionManager(): HoloDoriExpressionManager {
    return this._holoExpression;
  }

  public async init(
    gl: WebGLRenderingContext,
    loadedPackage: LoadedModelPackage,
    canvasWidth: number,
    canvasHeight: number
  ): Promise<void> {
    this._loadedPackage = loadedPackage;

    // 1. Load model bytes into CubismModel
    this.loadModel(loadedPackage.mocBuffer, false);

    // 2. Setup model matrix layout
    const model = this.getModel();
    if (model) {
      const cw = model.getCanvasWidth();
      const ch = model.getCanvasHeight();
      if (cw > 0 && ch > 0) {
        // Normalize model coordinate space
        this._modelMatrix.setWidth(2.0);
        this._modelMatrix.setCenterPosition(0.0, 0.0);
      }
    }

    // 3. Create WebGL renderer
    this.createRenderer(canvasWidth, canvasHeight);
    const renderer = this.getRenderer();
    renderer.startUp(gl);
    renderer.setIsPremultipliedAlpha(true);

    // 4. Load WebGL Shaders
    // Framework loads shader text from /shaders/ folder
    await renderer.loadShaders('/shaders/');

    // 5. Upload textures to WebGL
    this._glTextures = [];
    for (let i = 0; i < loadedPackage.textureImages.length; i++) {
      const img = loadedPackage.textureImages[i];
      const tex = gl.createTexture();
      if (!tex) {
        throw new Error(`Failed to create WebGLTexture for texture #${i}`);
      }

      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.bindTexture(gl.TEXTURE_2D, null);

      renderer.bindTexture(i, tex);
      this._glTextures.push(tex);
    }

    // 6. Setup Eye Blink
    this.setupEyeBlink();

    // 7. Setup Breath
    this.setupBreath();

    // 8. Setup Physics if present
    if (loadedPackage.physicsBuffer) {
      this.loadPhysics(loadedPackage.physicsBuffer, loadedPackage.physicsBuffer.byteLength);
    }

    this.setInitialized(true);
  }

  public hasPhysics(): boolean {
    return this._physics !== null;
  }

  public getPhysicsRigCount(): number {
    if (!this._physics) return 0;
    try {
      const rig = (this._physics as any)._physicsRig;
      if (rig && Array.isArray(rig.settings)) {
        return rig.settings.length;
      }
      if (rig && typeof rig.subrigCount === 'number') {
        return rig.subrigCount;
      }
    } catch {
      // ignore
    }
    return this._physics ? 1 : 0;
  }

  public attachPhysics(buffer: ArrayBuffer): void {
    this.loadPhysics(buffer, buffer.byteLength);
  }

  private setupEyeBlink(): void {
    const model = this.getModel();
    if (!model) return;

    const idManager = CubismFramework.getIdManager();
    const candidates = [
      'ParamEyeLOpen',
      'ParamEyeROpen',
      'PARAM_EYE_L_OPEN',
      'PARAM_EYE_R_OPEN',
    ];

    const validHandles: CubismIdHandle[] = [];
    for (const cand of candidates) {
      const handle = idManager.getId(cand);
      if (model.getParameterIndex(handle) >= 0) {
        validHandles.push(handle);
      }
    }

    if (validHandles.length > 0) {
      this._eyeBlink = CubismEyeBlink.create();
      this._eyeBlink.setParameterIds(validHandles);
    }
  }

  private setupBreath(): void {
    const model = this.getModel();
    if (!model) return;

    const idManager = CubismFramework.getIdManager();
    const breathParams: BreathParameterData[] = [];

    const breathId = idManager.getId('ParamBreath');
    if (model.getParameterIndex(breathId) >= 0) {
      breathParams.push(new BreathParameterData(breathId, 0.5, 0.5, 3.2345, 1.0));
    }

    const angleX = idManager.getId('ParamAngleX');
    if (model.getParameterIndex(angleX) >= 0) {
      breathParams.push(new BreathParameterData(angleX, 0.0, 5.0, 6.5345, 0.5));
    }

    const angleY = idManager.getId('ParamAngleY');
    if (model.getParameterIndex(angleY) >= 0) {
      breathParams.push(new BreathParameterData(angleY, 0.0, 5.0, 5.5345, 0.5));
    }

    const bodyAngleX = idManager.getId('ParamBodyAngleX');
    if (model.getParameterIndex(bodyAngleX) >= 0) {
      breathParams.push(new BreathParameterData(bodyAngleX, 0.0, 2.0, 15.5345, 0.5));
    }

    if (breathParams.length > 0) {
      this._breath = CubismBreath.create();
      this._breath.setParameters(breathParams);
    }
  }

  public updateModel(deltaTimeSeconds: number, options: ViewerOptions): void {
    const model = this.getModel();
    if (!model || !this.isInitialized()) return;

    model.loadParameters();

    // 1. HoloDori Motion (primary animation)
    if (this._motionManager) {
      this._motionManager.updateMotion(model, deltaTimeSeconds);
    }

    // 2. HoloDori Expression (expression overlay)
    if (this._expressionManager) {
      this._expressionManager.updateMotion(model, deltaTimeSeconds);
    }

    // 3. Procedural Eye Blink
    if (options.enableEyeBlink && this._eyeBlink) {
      this._eyeBlink.updateParameters(model, deltaTimeSeconds);
    }

    // 4. Procedural Breathing Idle
    if (options.enableBreath && this._breath) {
      this._breath.updateParameters(model, deltaTimeSeconds);
    }

    // 5. Authentic Live2D Physics
    if (options.enablePhysics && this._physics) {
      this._physics.evaluate(model, deltaTimeSeconds);
    }

    // 6. User slider overrides (manual inspection)
    for (const [paramIndex, value] of this._userOverrides.entries()) {
      model.setParameterValueByIndex(paramIndex, value);
    }

    model.update();
  }

  public drawModel(
    viewProjection: CubismMatrix44,
    viewport: number[],
    fbo: WebGLFramebuffer | null
  ): void {
    if (!this.getModel() || !this.isInitialized()) return;

    const renderer = this.getRenderer();
    if (!renderer) return;

    // Multiply view-projection with model matrix
    const mvp = new CubismMatrix44();
    mvp.multiplyByMatrix(viewProjection);
    mvp.multiplyByMatrix(this._modelMatrix);

    renderer.setMvpMatrix(mvp);
    renderer.setRenderState(fbo as unknown as WebGLFramebuffer, viewport);
    renderer.drawModel('/shaders/');
  }

  public resize(_width: number, _height: number): void {
    if (this.getRenderer()) {
      this.getRenderer().initialize(this.getModel(), 1);
    }
  }

  // --- Parameter controls ---

  public getParameters(): ModelParameterInfo[] {
    const model = this.getModel();
    if (!model) return [];
    return extractParameters(model);
  }

  public setParameter(paramIndex: number, value: number): void {
    const model = this.getModel();
    if (!model) return;
    this._userOverrides.set(paramIndex, value);
    model.setParameterValueByIndex(paramIndex, value);
  }

  public resetParameter(paramIndex: number): void {
    const model = this.getModel();
    if (!model) return;
    this._userOverrides.delete(paramIndex);
    const def = model.getParameterDefaultValue(paramIndex);
    model.setParameterValueByIndex(paramIndex, def);
  }

  public resetAllParameters(): void {
    const model = this.getModel();
    if (!model) return;
    this._userOverrides.clear();
    const count = model.getParameterCount();
    for (let i = 0; i < count; i++) {
      const def = model.getParameterDefaultValue(i);
      model.setParameterValueByIndex(i, def);
    }
  }

  public disposeModel(gl: WebGLRenderingContext): void {
    for (const tex of this._glTextures) {
      try {
        gl.deleteTexture(tex);
      } catch (e) {
        console.warn('Error deleting texture', e);
      }
    }
    this._glTextures = [];
    this._userOverrides.clear();

    if (this._holoMotion) {
      this._holoMotion.stopMotion();
    }
    if (this._holoExpression) {
      this._holoExpression.clearExpression();
    }

    this.deleteRenderer();
    this.release();

    if (this._loadedPackage) {
      this._loadedPackage.dispose();
      this._loadedPackage = null;
    }
    this.setInitialized(false);
  }
}
