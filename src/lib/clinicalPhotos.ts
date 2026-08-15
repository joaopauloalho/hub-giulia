export type PhotoAngle = 'front' | 'left_45' | 'right_45' | 'left_profile' | 'right_profile' | 'close_up' | 'detail' | 'other';
export type PhotoPose = 'rest' | 'smile' | 'expression' | 'custom';
export type PhotoSessionType = 'baseline' | 'pre_procedure' | 'immediate_post' | 'followup' | 'progress' | 'other';
export type PhotoCaptureSet = 'face_standard' | 'free';
export type ClinicalPhotoSource = 'camera' | 'library' | 'upload';
export type SniffedImageKind = 'jpeg' | 'png' | 'webp' | 'heic' | null;

export const FACE_STANDARD_ANGLES: readonly PhotoAngle[] = ['front', 'right_45', 'right_profile', 'left_45', 'left_profile'];

export const PHOTO_ANGLE_LABELS: Record<PhotoAngle, string> = {
  front: 'Frontal',
  right_45: '45° direita',
  right_profile: 'Perfil direito',
  left_45: '45° esquerda',
  left_profile: 'Perfil esquerdo',
  close_up: 'Close-up',
  detail: 'Detalhe',
  other: 'Outro / Livre',
};

export const PHOTO_SESSION_LABELS: Record<PhotoSessionType, string> = {
  baseline: 'Inicial',
  pre_procedure: 'Antes',
  immediate_post: 'Depois imediato',
  followup: 'Retorno',
  progress: 'Evolução',
  other: 'Outro',
};

export const PHOTO_REGION_OPTIONS = ['Face', 'Lábios', 'Olhos', 'Testa', 'Pescoço', 'Corporal', 'Outro'] as const;

export interface PairablePhoto {
  id: string;
  angle: PhotoAngle | null;
}

export interface SessionPhotoPair<T extends PairablePhoto> {
  angle: PhotoAngle;
  before: T | null;
  after: T | null;
}

const MAX_INPUT_BYTES = 30 * 1024 * 1024;
const MAX_CANONICAL_BYTES = 18 * 1024 * 1024;
const MAX_PIXELS = 50_000_000;

function bytesEqualAt(bytes: Uint8Array, offset: number, expected: readonly number[]) {
  return expected.every((value, index) => bytes[offset + index] === value);
}

export async function sniffImageKind(file: Blob): Promise<SniffedImageKind> {
  const bytes = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  if (bytes.length >= 3 && bytesEqualAt(bytes, 0, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (bytes.length >= 8 && bytesEqualAt(bytes, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (bytes.length >= 12 && bytesEqualAt(bytes, 0, [0x52, 0x49, 0x46, 0x46]) && bytesEqualAt(bytes, 8, [0x57, 0x45, 0x42, 0x50])) return 'webp';
  if (bytes.length >= 12 && bytesEqualAt(bytes, 4, [0x66, 0x74, 0x79, 0x70])) {
    const brand = String.fromCharCode(...bytes.slice(8, 12)).toLowerCase();
    if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'heic';
  }
  return null;
}

export function pairSessionPhotos<T extends PairablePhoto>(before: readonly T[], after: readonly T[]): SessionPhotoPair<T>[] {
  const order: PhotoAngle[] = [...FACE_STANDARD_ANGLES, 'close_up', 'detail', 'other'];
  const seen = new Set<PhotoAngle>();
  const pairs: SessionPhotoPair<T>[] = [];
  for (const angle of order) {
    const a = before.find(photo => photo.angle === angle) ?? null;
    const b = after.find(photo => photo.angle === angle) ?? null;
    if (a || b) {
      pairs.push({ angle, before: a, after: b });
      seen.add(angle);
    }
  }
  for (const photo of [...before, ...after]) {
    if (!photo.angle || seen.has(photo.angle)) continue;
    pairs.push({ angle: photo.angle, before: before.find(item => item.angle === photo.angle) ?? null, after: after.find(item => item.angle === photo.angle) ?? null });
    seen.add(photo.angle);
  }
  return pairs;
}

export function isSamePhotoComparison(beforeId: string | null | undefined, afterId: string | null | undefined) {
  return Boolean(beforeId && afterId && beforeId === afterId);
}

export function photoStoragePaths(userId: string, patientId: string, photoId: string, mimeType: 'image/jpeg' | 'image/png') {
  const ext = mimeType === 'image/png' ? 'png' : 'jpg';
  const root = `${userId}/patients/${patientId}/photos/${photoId}`;
  return {
    original: `${root}/original.${ext}`,
    preview: `${root}/preview.${ext}`,
    thumbnail: `${root}/thumb.${ext}`,
  };
}

function canvasBlob(canvas: HTMLCanvasElement, mimeType: 'image/jpeg' | 'image/png', quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Não foi possível preparar a imagem.')), mimeType, quality);
  });
}

async function decodeImage(file: Blob): Promise<{ source: CanvasImageSource; width: number; height: number; cleanup: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      return { source: bitmap, width: bitmap.width, height: bitmap.height, cleanup: () => bitmap.close() };
    } catch {
      // Safari can decode some formats through <img> even when createImageBitmap cannot.
    }
  }
  if (typeof document === 'undefined') throw new Error('Decodificação de imagem indisponível neste navegador.');
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = 'async';
  image.src = url;
  try {
    await image.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('Formato de imagem incompatível. No iPhone/iPad, use JPEG ou escolha “Mais compatível” se HEIC não abrir.');
  }
  return { source: image, width: image.naturalWidth, height: image.naturalHeight, cleanup: () => URL.revokeObjectURL(url) };
}

async function renderImage(source: CanvasImageSource, width: number, height: number, mimeType: 'image/jpeg' | 'image/png', maxSide: number | null, quality: number) {
  const scale = maxSide && Math.max(width, height) > maxSide ? maxSide / Math.max(width, height) : 1;
  const outWidth = Math.max(1, Math.round(width * scale));
  const outHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = outWidth;
  canvas.height = outHeight;
  const ctx = canvas.getContext('2d', { alpha: mimeType === 'image/png' });
  if (!ctx) throw new Error('Canvas indisponível para preparar a imagem.');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, outWidth, outHeight);
  return canvasBlob(canvas, mimeType, mimeType === 'image/jpeg' ? quality : undefined);
}

async function sha256(blob: Blob) {
  if (!globalThis.crypto?.subtle) throw new Error('SHA-256 indisponível neste navegador.');
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export interface PreparedClinicalPhoto {
  original: Blob;
  preview: Blob;
  thumbnail: Blob;
  mimeType: 'image/jpeg' | 'image/png';
  width: number;
  height: number;
  sizeBytes: number;
  sha256: string;
}

export async function prepareClinicalPhoto(file: File | Blob, sourceType: ClinicalPhotoSource): Promise<PreparedClinicalPhoto> {
  if (file.size <= 0) throw new Error('A imagem está vazia.');
  if (file.size > MAX_INPUT_BYTES) throw new Error('A imagem é muito grande. Escolha uma foto de até 30 MB.');
  const kind = await sniffImageKind(file);
  if (!kind) throw new Error('Arquivo inválido. Use uma foto JPEG, PNG, WebP ou HEIC/HEIF compatível. SVG não é aceito.');

  const decoded = await decodeImage(file);
  try {
    if (!decoded.width || !decoded.height || decoded.width * decoded.height > MAX_PIXELS) {
      throw new Error('A resolução da imagem excede o limite seguro de processamento no dispositivo.');
    }

    // Camera frames are already browser-generated JPEGs without EXIF. Library/upload files are
    // rendered once to normalize orientation and discard EXIF/GPS while preserving the visible pixels.
    const canonicalMime: 'image/jpeg' | 'image/png' = kind === 'png' ? 'image/png' : 'image/jpeg';
    const original = sourceType === 'camera' && kind === 'jpeg'
      ? file
      : await renderImage(decoded.source, decoded.width, decoded.height, canonicalMime, null, 0.96);
    if (original.size > MAX_CANONICAL_BYTES) throw new Error('A imagem preparada ficou acima de 18 MB. Use uma foto menor antes de enviar.');

    const preview = await renderImage(decoded.source, decoded.width, decoded.height, canonicalMime, 1600, 0.9);
    const thumbnail = await renderImage(decoded.source, decoded.width, decoded.height, canonicalMime, 480, 0.82);
    return {
      original,
      preview,
      thumbnail,
      mimeType: canonicalMime,
      width: decoded.width,
      height: decoded.height,
      sizeBytes: original.size,
      sha256: await sha256(original),
    };
  } finally {
    decoded.cleanup();
  }
}

export async function captureVideoFrame(video: HTMLVideoElement) {
  if (!video.videoWidth || !video.videoHeight) throw new Error('A câmera ainda não está pronta.');
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Não foi possível capturar a câmera.');
  // Intentionally draw the raw video frame. Front-camera mirroring is preview-only CSS.
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await canvasBlob(canvas, 'image/jpeg', 0.97);
  return new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
}

export async function exportSideBySideComparison(beforeUrl: string, afterUrl: string, beforeDate: string, afterDate: string) {
  if (typeof document === 'undefined') throw new Error('Exportação indisponível.');
  const load = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não foi possível carregar as imagens para exportação.'));
    img.src = url;
  });
  const [before, after] = await Promise.all([load(beforeUrl), load(afterUrl)]);
  const panel = 1200;
  const header = 120;
  const canvas = document.createElement('canvas');
  canvas.width = panel * 2;
  canvas.height = 1600 + header;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Exportação indisponível.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#242126';
  ctx.font = '600 42px system-ui, sans-serif';
  ctx.fillText(`ANTES · ${beforeDate}`, 40, 72);
  ctx.fillText(`DEPOIS · ${afterDate}`, panel + 40, 72);

  const drawContain = (img: HTMLImageElement, x: number) => {
    const maxW = panel;
    const maxH = 1600;
    const scale = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    ctx.drawImage(img, x + (maxW - w) / 2, header + (maxH - h) / 2, w, h);
  };
  drawContain(before, 0);
  drawContain(after, panel);
  ctx.fillStyle = 'rgba(36,33,38,.72)';
  ctx.font = '500 26px system-ui, sans-serif';
  ctx.fillText('Comparação clínica · imagem derivada', 40, canvas.height - 24);
  return canvasBlob(canvas, 'image/jpeg', 0.92);
}
