import { describe, expect, it } from 'vitest';
import { isSamePhotoComparison, pairSessionPhotos, photoStoragePaths, sniffImageKind, type PairablePhoto } from './clinicalPhotos';

describe('clinicalPhotos', () => {
  it('pairs only matching structured angles and keeps missing counterparts explicit', () => {
    const before: PairablePhoto[] = [{ id: 'a', angle: 'front' }, { id: 'b', angle: 'left_45' }];
    const after: PairablePhoto[] = [{ id: 'c', angle: 'front' }, { id: 'd', angle: 'right_45' }];
    expect(pairSessionPhotos(before, after)).toEqual([
      { angle: 'front', before: before[0], after: after[0] },
      { angle: 'right_45', before: null, after: after[1] },
      { angle: 'left_45', before: before[1], after: null },
    ]);
  });

  it('never allows the same photo as both sides', () => {
    expect(isSamePhotoComparison('x', 'x')).toBe(true);
    expect(isSamePhotoComparison('x', 'y')).toBe(false);
  });

  it('builds opaque tenant/patient/photo paths without original filenames', () => {
    expect(photoStoragePaths('u', 'p', 'ph', 'image/jpeg')).toEqual({
      original: 'u/patients/p/photos/ph/original.jpg',
      preview: 'u/patients/p/photos/ph/preview.jpg',
      thumbnail: 'u/patients/p/photos/ph/thumb.jpg',
    });
  });

  it('sniffs accepted raster formats and rejects SVG/text', async () => {
    expect(await sniffImageKind(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0x00])]))).toBe('jpeg');
    expect(await sniffImageKind(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])]))).toBe('png');
    expect(await sniffImageKind(new Blob(['<svg></svg>'], { type: 'image/svg+xml' }))).toBeNull();
  });
});
