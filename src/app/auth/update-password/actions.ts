'use server';
import {createClient} from '@/lib/supabase/server';
export async function updatePassword(_previous:unknown,form:FormData){
 const password=String(form.get('password')||'');const confirmation=String(form.get('confirmation')||'');
 if(password.length<8||password.length>72)return {error:'Use uma senha com 8 a 72 caracteres.'};
 if(password!==confirmation)return {error:'As senhas não coincidem.'};
 try{const db=await createClient();const {data:{user}}=await db.auth.getUser();if(!user)return {error:'Link expirado. Solicite uma nova recuperação.'};
 const {error}=await db.auth.updateUser({password});if(error){return {error:error.code==='same_password'?'Escolha uma senha diferente da anterior.':'Não foi possível alterar a senha. Confira os requisitos ou solicite um novo link.'};}
 await db.auth.signOut({scope:'local'});return {success:true};
 }catch{return {error:'Falha na conexão. Tente novamente.'};}
}
