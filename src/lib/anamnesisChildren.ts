/** Optional family context recorded as JSON inside the existing surgical_history map. */
export interface AnamnesisChild {
  nome: string;
  sexo: string;
}

export const MAX_ANAMNESIS_CHILDREN = 30;

export function parseAnamnesisChildren(value: unknown): AnamnesisChild[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_ANAMNESIS_CHILDREN).map(item => {
      const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      return {
        nome: typeof record.nome === 'string' ? record.nome : '',
        sexo: typeof record.sexo === 'string' ? record.sexo : '',
      };
    });
  } catch {
    return [];
  }
}

export function serializeAnamnesisChildren(children: AnamnesisChild[]): string {
  return children.length ? JSON.stringify(children.slice(0, MAX_ANAMNESIS_CHILDREN)) : '';
}

export function resizeAnamnesisChildren(value: unknown, amount: number): string {
  const size = Math.min(MAX_ANAMNESIS_CHILDREN, Math.max(0, Math.trunc(Number.isFinite(amount) ? amount : 0)));
  const previous = parseAnamnesisChildren(value);
  return serializeAnamnesisChildren(Array.from({ length: size }, (_, index) => previous[index] ?? { nome: '', sexo: '' }));
}

export function updateAnamnesisChild(
  value: unknown,
  amount: number,
  index: number,
  field: keyof AnamnesisChild,
  nextValue: string,
): string {
  const resized = parseAnamnesisChildren(resizeAnamnesisChildren(value, amount));
  if (index < 0 || index >= resized.length) return serializeAnamnesisChildren(resized);
  resized[index] = { ...resized[index], [field]: nextValue };
  return serializeAnamnesisChildren(resized);
}

export function summarizeAnamnesisChildren(value: unknown): string {
  const children = parseAnamnesisChildren(value);
  const listed = children.map((child, i) => {
    const parts = [child.nome.trim(), child.sexo.trim()].filter(Boolean);
    return parts.length ? `Filho(a) ${i + 1}: ${parts.join(' · ')}` : '';
  }).filter(Boolean);
  return listed.length ? listed.join('\n') : 'Não informado';
}
