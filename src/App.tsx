import { Component, type ReactNode } from 'react';
import AppRoutesV2 from './AppRoutesV2';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: '2rem', textAlign: 'center' }}>
          <p style={{ color: '#e53e3e', marginBottom: '1rem' }}>Algo deu errado. Recarregue a página.</p>
          <button onClick={() => window.location.reload()} style={{ padding: '0.5rem 1.5rem' }}>Recarregar</button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return <ErrorBoundary><AppRoutesV2 /></ErrorBoundary>;
}
