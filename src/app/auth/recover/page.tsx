import {headers} from 'next/headers';
import {redirect} from 'next/navigation';
import RecoverForm from './RecoverForm';
export const dynamic='force-dynamic';
export default async function RecoverPage(){
 const origin=process.env.APP_URL || 'https://comercial-simpledev.vercel.app';
 const host=(await headers()).get('host');
 if(origin && host!==new URL(origin).host) redirect(new URL('/auth/recover',origin).toString());
 return <RecoverForm/>;
}
