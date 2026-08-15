import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useDirtyFormGuard } from '../../hooks/useDirtyFormGuard';

export function DirtySurface({ id, children, cleanWhenText }: { id: string; children: ReactNode; cleanWhenText?: string }) {
  const [dirty, setDirty] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDirtyFormGuard(id, dirty);

  useEffect(() => {
    if (!cleanWhenText || !ref.current) return;
    const node = ref.current;
    const check = () => {
      if (node.textContent?.includes(cleanWhenText)) setDirty(false);
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(node, { subtree: true, childList: true, characterData: true });
    return () => observer.disconnect();
  }, [cleanWhenText]);

  return (
    <div
      ref={ref}
      onInputCapture={() => setDirty(true)}
      onChangeCapture={() => setDirty(true)}
    >
      {children}
    </div>
  );
}
