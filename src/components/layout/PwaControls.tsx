import { useEffect, useState } from 'react';
import { Download, RefreshCw, Wifi, WifiOff, X } from 'lucide-react';
import { useNetworkStatus } from '../../hooks/useNetworkStatus';
import { hasDirtyForms, subscribeDirtyState } from '../../lib/dirtyState';
import {
  HUB_PWA_INSTALL_EVENT,
  HUB_PWA_UPDATE_EVENT,
  applyWaitingServiceWorker,
  isIosFamily,
  isStandaloneDisplayMode,
  promptHubInstall,
} from '../../lib/pwa';

export function PwaControls() {
  const { online, restored } = useNetworkStatus();
  const [updateAvailable, setUpdateAvailable] = useState(false);
  const [installReady, setInstallReady] = useState(() => Boolean(window.__hubInstallPrompt));
  const [dirty, setDirty] = useState(hasDirtyForms());
  const [showIosHelp, setShowIosHelp] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const iosInstall = isIosFamily() && !isStandaloneDisplayMode();

  useEffect(() => {
    const update = () => setUpdateAvailable(true);
    const install = () => setInstallReady(Boolean(window.__hubInstallPrompt));
    window.addEventListener(HUB_PWA_UPDATE_EVENT, update);
    window.addEventListener(HUB_PWA_INSTALL_EVENT, install);
    const unsubscribe = subscribeDirtyState(() => setDirty(hasDirtyForms()));
    if (window.__hubServiceWorkerRegistration?.waiting) setUpdateAvailable(true);
    return () => {
      window.removeEventListener(HUB_PWA_UPDATE_EVENT, update);
      window.removeEventListener(HUB_PWA_INSTALL_EVENT, install);
      unsubscribe();
    };
  }, []);

  const install = async () => {
    if (installReady) {
      const choice = await promptHubInstall();
      if (choice?.outcome === 'accepted') setInstallReady(false);
      return;
    }
    if (iosInstall) setShowIosHelp(true);
  };

  const update = async () => {
    setUpdateMessage(null);
    if (dirty) {
      setUpdateMessage('Conclua ou salve o formulário antes de atualizar.');
      return;
    }
    const applied = await applyWaitingServiceWorker();
    if (!applied) setUpdateMessage('A nova versão ainda não está pronta.');
  };

  return (
    <>
      <div className="hub-runtime-controls">
        {!online ? <span className="hub-network is-offline"><WifiOff size={14} /> Sem conexão</span> : restored ? <span className="hub-network is-online"><Wifi size={14} /> Conexão restabelecida</span> : null}
        {updateAvailable && <button type="button" className="hub-runtime-action" onClick={() => void update()}><RefreshCw size={14} /> Nova versão</button>}
        {(installReady || iosInstall) && <button type="button" className="hub-runtime-action hub-install-action" onClick={() => void install()}><Download size={14} /> Instalar</button>}
      </div>
      {updateMessage && <div className="hub-runtime-message" role="status">{updateMessage}<button type="button" onClick={() => setUpdateMessage(null)} aria-label="Fechar"><X size={14} /></button></div>}
      {showIosHelp && (
        <div className="hub-command-overlay" role="presentation" onMouseDown={event => event.target === event.currentTarget && setShowIosHelp(false)}>
          <section className="hub-install-sheet" role="dialog" aria-modal="true" aria-label="Instalar Hub Giulia">
            <div className="hub-install-sheet-head"><strong>Instalar Hub Giulia</strong><button className="icon-btn" onClick={() => setShowIosHelp(false)} aria-label="Fechar"><X size={18} /></button></div>
            <p>No Safari do iPhone/iPad, toque em <strong>Compartilhar</strong> e depois em <strong>Adicionar à Tela de Início</strong>.</p>
            <p className="page-sub">Depois, abra o Hub pelo ícone para usar em modo standalone.</p>
          </section>
        </div>
      )}
    </>
  );
}
