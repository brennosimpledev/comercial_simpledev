'use client';
import {useEffect, useState} from 'react';
import {useRouter} from 'next/navigation';
import {confirmRecovery} from './actions';

export default function ConfirmForm() {
  const router = useRouter();
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  useEffect(() => {
    const value = new URLSearchParams(window.location.hash.slice(1)).get('token_hash');
    if (value) {
      setToken(value);
      window.history.replaceState(null, '', window.location.pathname);
    } else setError('Abra o link de recuperação fornecido pelo administrador.');
  }, []);
  async function confirm() {
    setPending(true);
    setError('');
    try {
      const result = await confirmRecovery(token);
      if (result.error) { setError(result.error); setPending(false); }
      else { setToken(''); router.replace('/auth/update-password'); router.refresh(); }
    } catch { setError('Falha na conexão. Tente novamente.'); setPending(false); }
  }
  return <main className="flex min-h-screen items-center justify-center bg-navy px-4"><div className="w-full max-w-sm rounded-2xl border border-white/10 bg-navy-mid p-8">
    <h1 className="text-xl font-semibold">Recuperar acesso ao CRM</h1>
    <p className="mt-3 text-sm text-slate-300">Clique abaixo para confirmar a recuperação e escolher sua nova senha. O link só será usado após esta confirmação.</p>
    {error && <p role="alert" className="mt-4 text-sm text-red-300">{error}</p>}
    <button type="button" onClick={confirm} disabled={!token || pending} className="sd-btn mt-5 w-full">{pending ? 'Confirmando…' : 'Continuar e definir senha'}</button>
  </div></main>;
}
