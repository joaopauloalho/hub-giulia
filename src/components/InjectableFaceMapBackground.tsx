export const FACE_MAP_WIDTH = 300;
export const FACE_MAP_HEIGHT = 380;
export const FACE_MAP_IMAGE = '/face-botox.png';

export function InjectableFaceMapBackground() {
  return (
    <image
      href={FACE_MAP_IMAGE}
      x="0"
      y="0"
      width={FACE_MAP_WIDTH}
      height={FACE_MAP_HEIGHT}
      preserveAspectRatio="xMidYMid meet"
      style={{ pointerEvents: 'none' }}
    />
  );
}
