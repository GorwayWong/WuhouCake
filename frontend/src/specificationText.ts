function isUnitText(value: unknown): boolean {
  return typeof value === 'string' && /^[个块件只片份盒袋包杯瓶套条枚支](?:\s*[、，,/／]\s*[个块件只片份盒袋包杯瓶套条枚支])*$/.test(value.trim());
}

export function visibleSpecification<T>(value: T): T | '' {
  return isUnitText(value) || (Array.isArray(value) && value.length > 0 && value.every(isUnitText)) ? '' : value;
}
