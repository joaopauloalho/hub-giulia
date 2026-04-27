import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Tenta sessão já existente (token processado antes do mount)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setReady(true);
    });
    // Fallback: escuta o evento caso ainda não tenha disparado
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') setReady(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) { setError('As senhas não coincidem.'); return; }
    if (password.length < 6) { setError('Mínimo 6 caracteres.'); return; }
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) { setError(error.message); setLoading(false); return; }
    await supabase.auth.signOut();
    navigate('/login');
  };

  if (!ready) {
    return (
      <div className="login-shell">
        <div className="login-card">
          <div className="login-brand">
            <span className="logo-text">hub</span>
            <span className="logo-accent">giulia</span>
          </div>
          <p className="login-sub">Aguardando link de recuperação...</p>
          <p style={{ color: 'var(--text-3)', fontSize: '0.85rem', marginTop: '12px' }}>
            Clique no link do email de recuperação para continuar.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <span className="logo-text">hub</span>
          <span className="logo-accent">giulia</span>
        </div>
        <p className="login-sub">Defina sua nova senha</p>
        <form onSubmit={handleSubmit} className="login-form" style={{ marginTop: '20px' }}>
          <Input
            label="Nova senha"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            autoFocus
          />
          <Input
            label="Confirmar senha"
            type="password"
            placeholder="••••••••"
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            required
          />
          {error && <p className="login-error">{error}</p>}
          <Button type="submit" disabled={loading} className="w-full">
            {loading ? 'Salvando...' : 'Salvar senha'}
          </Button>
        </form>
      </div>
    </div>
  );
}
