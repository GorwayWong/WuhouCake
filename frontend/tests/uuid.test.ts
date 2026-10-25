import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from '../src/uuid.ts';
import { newItem } from '../src/orderForm.ts';
import { emptyRecognitionItem } from '../src/recognition.ts';

test('HTTP 环境缺少原生 randomUUID 时仍能生成提交标识并初始化表单', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto')!;
  const getRandomValues = crypto.getRandomValues.bind(crypto);
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues } });
  try {
    const ids = [randomUUID(), newItem().key, emptyRecognitionItem().key];
    for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(new Set(ids).size, ids.length);
  } finally { Object.defineProperty(globalThis, 'crypto', original); }
});

test('UUID 设置标准版本和变体位，零字节保留两位十六进制', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto')!;
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues: (bytes: Uint8Array) => bytes.fill(0) } });
  try { assert.equal(randomUUID(), '00000000-0000-4000-8000-000000000000'); }
  finally { Object.defineProperty(globalThis, 'crypto', original); }
});
