import { useEffect } from 'react';

export function AnamnesisTabletExitGuard() {
  useEffect(() => {
    const blockBackdropExit = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      const overlay = event.target.closest('.drawer-overlay');
      if (!overlay) return;

      const activeTab = overlay.querySelector('.patient-360-tabs .sub-tab--active');
      if (activeTab?.textContent?.trim() !== 'Anamnese') return;

      const drawer = overlay.querySelector('.patient-360-drawer');
      if (drawer?.contains(event.target)) return;

      event.preventDefault();
      event.stopPropagation();
    };

    document.addEventListener('pointerdown', blockBackdropExit, true);
    document.addEventListener('click', blockBackdropExit, true);
    return () => {
      document.removeEventListener('pointerdown', blockBackdropExit, true);
      document.removeEventListener('click', blockBackdropExit, true);
    };
  }, []);

  return null;
}
