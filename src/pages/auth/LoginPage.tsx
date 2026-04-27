import { useState, FormEvent } from 'react';
import { supabase } from '../../lib/supabase';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      setSent(true);
    }
  };

  return (
    <div className="login-shell">
      <div className="login-card">
        <div className="login-brand">
          <span className="logo-text">hub</span>
          <span className="logo-accent">giulia</span>
        </div>

        {sent ? (
          <>
            <p className="login-sub" style={{ marginTop: '8px' }}>Link enviado!</p>
            <p style={{ color: 'var(--text-3)', fontSize: '0.875rem', marginTop: '12px', lineHeight: '1.6' }}>
              Verifique o email <strong style={{ color: 'var(--text-2)' }}>{email}</strong> e clique no link para entrar.
            </p>
          </>
        ) : (
          <>
            <p className="login-sub">Digite seu email para receber o link de acesso</p>
            <form onSubmit={handleSubmit} className="login-form">
              <Input
                label="Email"
                type="email"
                placeholder="seu@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                autoFocus
              />
              {error && <p className="login-error">{error}</p>}
              <Button type="submit" disabled={loading} className="w-full">
                {loading ? 'Enviando...' : 'Enviar link de acesso'}
              </Button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
