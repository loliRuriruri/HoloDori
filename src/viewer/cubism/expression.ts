import { CubismExpressionMotion } from './framework/motion/cubismexpressionmotion';
import { CubismExpressionMotionManager } from './framework/motion/cubismexpressionmotionmanager';
import { ExpressionPlayInfo } from '../types';

export class HoloDoriExpressionManager {
  private _manager: CubismExpressionMotionManager;
  private _currentInfo: ExpressionPlayInfo | null = null;
  private _onExpressionChange?: (info: ExpressionPlayInfo | null) => void;

  constructor(manager: CubismExpressionMotionManager) {
    this._manager = manager;
  }

  public setCallback(cb: (info: ExpressionPlayInfo | null) => void): void {
    this._onExpressionChange = cb;
  }

  public getCurrentInfo(): ExpressionPlayInfo | null {
    return this._currentInfo;
  }

  /**
   * Applies an expression to the model using .exp3.json ArrayBuffer.
   */
  public applyExpression(
    expBytes: ArrayBuffer,
    assetName: string,
    name: string
  ): CubismExpressionMotion | null {
    try {
      const exp = CubismExpressionMotion.create(expBytes, expBytes.byteLength);
      if (!exp) {
        return null;
      }

      this._manager.startMotion(exp, false);
      this._currentInfo = { assetName, name };
      if (this._onExpressionChange) {
        this._onExpressionChange(this._currentInfo);
      }
      return exp;
    } catch (e) {
      console.error('Failed to apply expression:', e);
      return null;
    }
  }

  /**
   * Clears the current expression, smoothly returning parameters to default state.
   */
  public clearExpression(): void {
    this._manager.stopAllMotions();
    this._currentInfo = null;
    if (this._onExpressionChange) {
      this._onExpressionChange(null);
    }
  }

  public getRawManager(): CubismExpressionMotionManager {
    return this._manager;
  }
}
