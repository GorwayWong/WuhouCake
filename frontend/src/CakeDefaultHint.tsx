import { cakeDefaults, isCakeDefaultField } from './productRules';

export function CakeDefaultHint({ field, template = false }: { field: string; template?: boolean }) {
  return isCakeDefaultField(field) ? <small className="specification-default-hint">（{template ? '下单时未填默认' : '不填默认'}{cakeDefaults[field]}）</small> : null;
}
