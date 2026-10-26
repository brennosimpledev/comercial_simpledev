import Link from 'next/link';
import {createClient} from '@/lib/supabase/server';
import {PasswordForm} from './PasswordForm';
export const dynamic='force-dynamic';
export default async function PasswordPage({searchParams}:{searchParams:Promise<{error?:string}>}){const {error}=await searchParams;const db=await createClient();const {data:{user}}=await db.auth.getUser();return <main className="flex min-h-screen items-center justify-center bg-navy px-4"><div className="w-full max-w-sm rounded-2xl border border-white/10 bg-navy-mid p-8"><h1 className="text-xl font-semibold">Definir nova senha</h1>{!user||error?<div className="mt-4 space-y-4"><p role="alert" className="text-sm text-slate-300">Este link está ausente, expirou ou foi aberto em outro navegador. Solicite um novo link e abra-o no mesmo navegador.</p><Link className="text-brand" href="/auth/recover">Solicitar novo link</Link></div>:<PasswordForm/>}</div></main>}
