"use server";
import {createClient} from '@/lib/supabase/server';

export async function confirmRecovery(token: string) {
  if (typeof token !== 'string' || !/^[a-f0-9]{40,128}$/i.test(token)) {
    return {error: 'Link de recuperação inválido.'};
  }
  try {
    const db = await createClient();
    const {error} = await db.auth.verifyOtp({token_hash: token, type: 'recovery'});
    if (error) return {error: 'Este link expirou ou já foi usado. Solicite um novo link ao administrador.'};
    return {success: true};
  } catch {
    return {error: 'Não foi possível confirmar o link. Tente novamente.'};
  }
}
