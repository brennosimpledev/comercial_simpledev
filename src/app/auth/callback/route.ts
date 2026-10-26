import {NextRequest,NextResponse} from 'next/server';
import {createClient} from '@/lib/supabase/server';
export async function GET(request:NextRequest){
 const code=request.nextUrl.searchParams.get('code');
 if(code){try{const db=await createClient();const {error}=await db.auth.exchangeCodeForSession(code);if(!error)return NextResponse.redirect(new URL('/auth/update-password',request.url));}catch{}}
 return NextResponse.redirect(new URL('/auth/update-password?error=invalid_link',request.url));
}
