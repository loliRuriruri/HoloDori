import { CubismMotion } from './framework/motion/cubismmotion';
import { CubismMotionManager } from './framework/motion/cubismmotionmanager';
import { MotionPlaybackState, MotionPlayInfo } from '../types';

export class HoloDoriMotionManager {
  private _manager: CubismMotionManager;
  private _state: MotionPlaybackState = 'idle';
  private _currentMotion: CubismMotion | null = null;
  private _currentInfo: MotionPlayInfo | null = null;
  private _onStateChange?: (state: MotionPlaybackState, info: MotionPlayInfo | null) => void;

  constructor(manager: CubismMotionManager) {
    this._manager = manager;
  }

  public setStateCallback(cb: (state: MotionPlaybackState, info: MotionPlayInfo | null) => void): void {
    this._onStateChange = cb;
  }

  public getState(): MotionPlaybackState {
    return this._state;
  }

  public getCurrentInfo(): MotionPlayInfo | null {
    return this._currentInfo;
  }

  public getCurrentMotion(): CubismMotion | null {
    return this._currentMotion;
  }

  private _setState(state: MotionPlaybackState, info: MotionPlayInfo | null = this._currentInfo): void {
    this._state = state;
    this._currentInfo = info;
    if (this._onStateChange) {
      this._onStateChange(state, info);
    }
  }

  /**
   * Plays a HoloDori motion from motion3.json ArrayBuffer.
   */
  public playMotion(
    motionBytes: ArrayBuffer,
    assetName: string,
    name: string
  ): CubismMotion | null {
    try {
      this._setState('loading', { assetName, name, duration: 0 });

      // Stop any existing active motion before starting new motion
      this._manager.stopAllMotions();

      const motion = CubismMotion.create(
        motionBytes,
        motionBytes.byteLength,
        (_motion) => {
          // onFinished callback
          this._currentMotion = null;
          this._setState('idle', null);
        },
        (_motion) => {
          // onBegan callback
        }
      );

      if (!motion) {
        this._setState('error', null);
        return null;
      }

      motion.setEffectIds([], []);

      const duration = motion.getDuration();
      this._elapsedTime = 0;
      this._duration = duration;
      const info: MotionPlayInfo = { assetName, name, duration };

      // Priority 2 (normal priority)
      this._manager.startMotionPriority(motion, false, 2);
      this._currentMotion = motion;
      this._setState('playing', info);

      return motion;
    } catch (e) {
      console.error('Failed to play motion:', e);
      this._setState('error', null);
      return null;
    }
  }

  /**
   * Interrupts and stops currently playing motion immediately.
   */
  public stopMotion(): void {
    this._manager.stopAllMotions();
    this._currentMotion = null;
    this._setState('idle', null);
  }

  private _elapsedTime = 0;
  private _duration = 0;
  private _onProgress?: (elapsed: number, duration: number, progress: number) => void;

  public setProgressCallback(cb: (elapsed: number, duration: number, progress: number) => void): void {
    this._onProgress = cb;
  }

  public getElapsedTime(): number {
    return this._elapsedTime;
  }

  public getDuration(): number {
    return this._duration;
  }

  public getProgress(): number {
    if (this._duration <= 0) return 0;
    return Math.min(1.0, this._elapsedTime / this._duration);
  }

  public updateMotion(model: any, deltaTimeSeconds: number): boolean {
    if (this._state === 'playing') {
      this._elapsedTime += deltaTimeSeconds;
      if (this._onProgress) {
        this._onProgress(this._elapsedTime, this._duration, this.getProgress());
      }
    }
    return this._manager.updateMotion(model, deltaTimeSeconds);
  }

  public isFinished(): boolean {
    return this._manager.isFinished();
  }

  public getRawManager(): CubismMotionManager {
    return this._manager;
  }
}
