"use server";
import {createClient} from '@/lib/supabase/server';
import {z} from 'zod';
export async function requestPasswordReset(_previous:unknown,form:FormData){
 const parsed=z.string().trim().email().max(254).safeParse(form.get('email'));
 if(!parsed.success)return {error:'Informe um e-mail válido.'};
 const origin=process.env.APP_URL || 'https://comercial-simpledev.vercel.app';
 if(!origin)return {error:'A recuperação de senha ainda precisa ser configurada neste ambiente.'};
 try{const db=await createClient();const {error}=await db.auth.resetPasswordForEmail(parsed.data,{redirectTo:new URL('/auth/callback',origin).toString()});
 if(error){if(error.status===429)return {error:'Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.'};return {error:'Não foi possível enviar o e-mail. Tente novamente ou fale com o administrador.'};}
 return {success:true};
 }catch{return {error:'Falha na conexão. Tente novamente.'};}
}
