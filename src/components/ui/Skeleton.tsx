interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  borderRadius?: number | string;
  lines?: number;
}

export function Skeleton({ width = '100%', height = 16, borderRadius = 8, lines = 1 }: SkeletonProps) {
  if (lines > 1) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width }}>
        {Array.from({ length: lines }, (_, index) => (
          <Skeleton
            key={index}
            width={index === lines - 1 ? '72%' : '100%'}
            height={height}
            borderRadius={borderRadius}
          />
        ))}
      </div>
    );
  }

  return (
    <span
      aria-hidden="true"
      className="skeleton"
      style={{ display: 'block', width, height, borderRadius }}
    />
  );
}
