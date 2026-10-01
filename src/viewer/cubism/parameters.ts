import { CubismModel } from './framework/model/cubismmodel';
import { ModelParameterInfo, ParameterCategory } from '../types';

export function extractParameters(model: CubismModel): ModelParameterInfo[] {
  const count = model.getParameterCount();
  const result: ModelParameterInfo[] = [];

  for (let i = 0; i < count; i++) {
    const idHandle = model.getParameterId(i);
    const id = idHandle ? idHandle.getString() : `Param_${i}`;
    const min = model.getParameterMinimumValue(i);
    const max = model.getParameterMaximumValue(i);
    const defaultValue = model.getParameterDefaultValue(i);
    const currentValue = model.getParameterValueByIndex(i);

    const category = categorizeParameter(id);
    const name = formatParameterName(id);

    result.push({
      id,
      name,
      min,
      max,
      defaultValue,
      currentValue,
      category,
    });
  }

  return result;
}

export function categorizeParameter(id: string): ParameterCategory {
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

export function formatParameterName(id: string): string {
  // Strip common Live2D prefix
  let clean = id;
  if (clean.startsWith('Param')) {
    clean = clean.substring(5);
  }
  // Insert spaces before capital letters: "AngleX" -> "Angle X", "EyeLOpen" -> "Eye L Open"
  const spaced = clean.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z])([A-Z][a-z])/g, '$1 $2');
  return spaced || id;
}

export function resetAllParametersToDefault(model: CubismModel): void {
  const count = model.getParameterCount();
  for (let i = 0; i < count; i++) {
    const def = model.getParameterDefaultValue(i);
    model.setParameterValueByIndex(i, def);
  }
}
