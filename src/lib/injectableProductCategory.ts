import type { InjectableProductV2 } from './injectablesV2';

export type InjectableProductCategory = 'bioestimulador' | 'toxina' | 'preenchimento' | 'outros';

export const INJECTABLE_PRODUCT_CATEGORIES: Array<{ value: InjectableProductCategory; label: string }> = [
  { value: 'bioestimulador', label: 'Bioestimulador' },
  { value: 'toxina', label: 'Toxina botulínica' },
  { value: 'preenchimento', label: 'Preenchimento' },
  { value: 'outros', label: 'Outros injetáveis' },
];

function normalize(value: string | null | undefined): string {
  return (value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

export function injectableServiceCategory(serviceName: string): InjectableProductCategory {
  const name = normalize(serviceName);
  if (/bioestimul/.test(name)) return 'bioestimulador';
  if (/toxina|botulin|botox|dysport/.test(name)) return 'toxina';
  if (/preench|hialuron|filler/.test(name)) return 'preenchimento';
  return 'outros';
}

/**
 * Old catalog entries had no category. Recognize only known product families
 * until they can be explicitly classified in the catalog manager.
 * The saved category always wins over the legacy name-based fallback.
 */
export function injectableProductCategory(
  product: Pick<InjectableProductV2, 'name' | 'category'>,
): InjectableProductCategory | null {
  const category = normalize(product.category);
  if (category) {
    if (/bioestimul/.test(category)) return 'bioestimulador';
    if (/toxina|botulin|neuromodul/.test(category)) return 'toxina';
    if (/preench|hialuron|filler/.test(category)) return 'preenchimento';
    if (/^outros?$|^other$/.test(category)) return 'outros';
    return null;
  }

  const name = normalize(product.name);
  if (/botox|botulift|dysport|xeomin|nabota|botulim|prosigne|botulax/.test(name)) return 'toxina';
  if (/sculptra|radiesse|ellanse|elleva|harmonyca|bioestimul|sculpfill/.test(name)) return 'bioestimulador';
  if (/belotero|biogelis|rennova diamond|restylane|juvederm|stylage|perfectha|saypha|eptq|revanesse/.test(name)) return 'preenchimento';
  return null;
}

export function compatibleInjectableProducts<T extends Pick<InjectableProductV2, 'name' | 'category' | 'active'>>(
  products: T[],
  serviceName: string,
): T[] {
  const serviceCategory = injectableServiceCategory(serviceName);
  return products.filter(product => product.active && injectableProductCategory(product) === serviceCategory);
}
