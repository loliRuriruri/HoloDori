import { CubismMatrix44 } from './framework/math/cubismmatrix44';
import { Live2DModelWrapper } from './model';
import { ViewportTransform, ViewerOptions } from '../types';

export interface ViewerRendererOptions {
  canvas: HTMLCanvasElement;
  onContextLost?: () => void;
  onContextRestored?: () => void;
}

export class ViewerRenderer {
  private _canvas: HTMLCanvasElement;
  private _gl: WebGLRenderingContext | null = null;
  private _model: Live2DModelWrapper | null = null;
  private _animFrameId: number | null = null;
  private _lastTime = 0;
  private _isPaused = false;

  private _transform: ViewportTransform = {
    zoom: 1.0,
    panX: 0.0,
    panY: 0.0,
  };

  private _viewerOptions: ViewerOptions = {
    enableBreath: true,
    enableEyeBlink: true,
  };

  private _onContextLostHandler: (e: Event) => void;
  private _onContextRestoredHandler: (e: Event) => void;
  private _onVisibilityChangeHandler: () => void;

  constructor(options: ViewerRendererOptions) {
    this._canvas = options.canvas;

    this._onContextLostHandler = (e: Event) => {
      e.preventDefault();
      console.warn('[ViewerRenderer] WebGL context lost');
      this.stop();
      if (options.onContextLost) options.onContextLost();
    };

    this._onContextRestoredHandler = () => {
      console.info('[ViewerRenderer] WebGL context restored');
      this.initGL();
      if (options.onContextRestored) options.onContextRestored();
    };

    this._onVisibilityChangeHandler = () => {
      if (document.hidden) {
        this._isPaused = true;
      } else {
        this._isPaused = false;
        this._lastTime = performance.now();
      }
    };

    this._canvas.addEventListener('webglcontextlost', this._onContextLostHandler, false);
    this._canvas.addEventListener('webglcontextrestored', this._onContextRestoredHandler, false);
    document.addEventListener('visibilitychange', this._onVisibilityChangeHandler, false);

    this.initGL();
  }

  private initGL(): void {
    const gl =
      this._canvas.getContext('webgl', {
        alpha: true,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
      }) ||
      (this._canvas.getContext('experimental-webgl', {
        alpha: true,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
      }) as WebGLRenderingContext | null);

    if (!gl) {
      throw new Error('WebGL is not supported in this environment');
    }

    this._gl = gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  public getGL(): WebGLRenderingContext {
    if (!this._gl) {
      this.initGL();
    }
    return this._gl!;
  }

  public setModel(model: Live2DModelWrapper | null): void {
    this._model = model;
  }

  public getModel(): Live2DModelWrapper | null {
    return this._model;
  }

  public setTransform(transform: Partial<ViewportTransform>): void {
    this._transform = {
      ...this._transform,
      ...transform,
    };
  }

  public getTransform(): ViewportTransform {
    return { ...this._transform };
  }

  public setViewerOptions(options: Partial<ViewerOptions>): void {
    this._viewerOptions = {
      ...this._viewerOptions,
      ...options,
    };
  }

  public resetCamera(): void {
    this._transform = {
      zoom: 1.0,
      panX: 0.0,
      panY: 0.0,
    };
  }

  public fitView(): void {
    this._transform.panX = 0.0;
    this._transform.panY = 0.0;
    this._transform.zoom = 1.0;
  }

  public start(): void {
    if (this._animFrameId !== null) return;
    this._lastTime = performance.now();
    this._isPaused = false;

    const loop = (now: number) => {
      this._animFrameId = requestAnimationFrame(loop);

      if (this._isPaused) return;

      const deltaMs = now - this._lastTime;
      this._lastTime = now;
      // Clamp delta time to max 100ms to avoid huge step after pauses
      const deltaSec = Math.min(Math.max(deltaMs / 1000.0, 0.001), 0.1);

      this.render(deltaSec);
    };

    this._animFrameId = requestAnimationFrame(loop);
  }

  public stop(): void {
    if (this._animFrameId !== null) {
      cancelAnimationFrame(this._animFrameId);
      this._animFrameId = null;
    }
  }

  public render(deltaTime: number): void {
    const gl = this._gl;
    if (!gl) return;

    const width = this._canvas.width;
    const height = this._canvas.height;
    if (width === 0 || height === 0) return;

    gl.viewport(0, 0, width, height);
    gl.clearColor(0.0, 0.0, 0.0, 0.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    if (this._model && this._model.isInitialized()) {
      // 1. Update model motions, breathing, eye-blink, parameters
      this._model.updateModel(deltaTime, this._viewerOptions);

      // 2. Compute View-Projection matrix
      const proj = new CubismMatrix44();
      const aspect = width / height;
      if (width > height) {
        proj.scale(1.0 / aspect, 1.0);
      } else {
        proj.scale(1.0, aspect);
      }

      proj.scaleRelative(this._transform.zoom, this._transform.zoom);
      proj.translateRelative(this._transform.panX, this._transform.panY);

      // 3. Draw model
      this._model.drawModel(proj, [0, 0, width, height], null);
    }
  }

  public resize(width: number, height: number): void {
    const dpr = window.devicePixelRatio || 1;
    const displayWidth = Math.round(width * dpr);
    const displayHeight = Math.round(height * dpr);

    if (this._canvas.width !== displayWidth || this._canvas.height !== displayHeight) {
      this._canvas.width = displayWidth;
      this._canvas.height = displayHeight;

      if (this._gl) {
        this._gl.viewport(0, 0, displayWidth, displayHeight);
      }
      if (this._model) {
        this._model.resize(displayWidth, displayHeight);
      }
    }
  }

  public dispose(): void {
    this.stop();

    this._canvas.removeEventListener('webglcontextlost', this._onContextLostHandler);
    this._canvas.removeEventListener('webglcontextrestored', this._onContextRestoredHandler);
    document.removeEventListener('visibilitychange', this._onVisibilityChangeHandler);

    if (this._model && this._gl) {
      this._model.disposeModel(this._gl);
      this._model = null;
    }

    this._gl = null;
  }
}
