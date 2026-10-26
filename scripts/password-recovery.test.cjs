const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('fs'),path=require('path'),Module=require('module'),ts=require('typescript');
function load(file,auth){const m=new Module(path.resolve(file),module);m.filename=path.resolve(file);m.paths=module.paths;m.require=id=>id==='@/lib/supabase/server'?{createClient:async()=>({auth})}:require(id);m._compile(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020}}).outputText,m.filename);return m.exports;}
function form(fields){const f=new FormData();for(const [k,v] of Object.entries(fields))f.set(k,v);return f}
test('password recovery validates inputs, uses configured callback and handles throttling',async()=>{process.env.APP_URL='http://localhost:3000';let calls=0;const {requestPasswordReset}=load('src/app/auth/recover/actions.ts',{resetPasswordForEmail:async(email,options)=>{calls++;assert.equal(email,'person@example.com');assert.equal(options.redirectTo,'http://localhost:3000/auth/callback');return {error:null}}});assert((await requestPasswordReset(null,form({email:'invalid'}))).error);assert.equal(calls,0);assert((await requestPasswordReset(null,form({email:'person@example.com'}))).success);const retry=load('src/app/auth/recover/actions.ts',{resetPasswordForEmail:async()=>({error:{status:429}})});assert((await retry.requestPasswordReset(null,form({email:'person@example.com'}))).error.includes('Muitas'));});
test('password update requires a session and matching input; successful update signs out locally',async()=>{const f=form({password:'synthetic-test-password',confirmation:'synthetic-test-password'});let changed=0;const base={getUser:async()=>({data:{user:null}}),updateUser:async()=>{changed++;return {error:null}}};const noSession=load('src/app/auth/update-password/actions.ts',base);assert((await noSession.updatePassword(null,f)).error);assert.equal(changed,0);const signedIn=load('src/app/auth/update-password/actions.ts',{...base,getUser:async()=>({data:{user:{id:'test'}}}),signOut:async options=>{assert.equal(options.scope,'local');return {error:null}}});assert((await signedIn.updatePassword(null,form({password:'short',confirmation:'short'}))).error);assert((await signedIn.updatePassword(null,form({password:'synthetic-test-password',confirmation:'different'}))).error);assert((await signedIn.updatePassword(null,f)).success);assert.equal(changed,1);});

test('recovery defaults to the canonical production URL without APP_URL', async()=>{
 delete process.env.APP_URL;
 let called=false;
 const action=load('src/app/auth/recover/actions.ts',{resetPasswordForEmail:async(email,options)=>{called=true;assert.equal(options.redirectTo,'https://comercial-simpledev.vercel.app/auth/callback');return {error:null}}});
 assert((await action.requestPasswordReset(null,form({email:'person@example.com'}))).success);
 assert(called);
});

test('callback only opens password form after a successful code exchange',async()=>{
 const {NextRequest}=require('next/server');let calls=0;
 const callback=load('src/app/auth/callback/route.ts',{exchangeCodeForSession:async code=>{calls++;assert.equal(code,'synthetic-code');return {error:null}}});
 const missing=await callback.GET(new NextRequest('https://comercial-simpledev.vercel.app/auth/callback'));
 assert(missing.headers.get('location').endsWith('/auth/update-password?error=invalid_link'));assert.equal(calls,0);
 const ok=await callback.GET(new NextRequest('https://comercial-simpledev.vercel.app/auth/callback?code=synthetic-code'));
 assert(ok.headers.get('location').endsWith('/auth/update-password'));assert.equal(calls,1);
 const failed=load('src/app/auth/callback/route.ts',{exchangeCodeForSession:async()=>({error:{message:'expired'}})});
 const invalid=await failed.GET(new NextRequest('https://comercial-simpledev.vercel.app/auth/callback?code=expired'));
 assert(invalid.headers.get('location').endsWith('?error=invalid_link'));
});

test('assisted recovery validates tokens and only verifies recovery OTPs', async()=>{
 let calls=0; const token='a'.repeat(56);
 const action=load('src/app/auth/confirm/actions.ts',{verifyOtp:async input=>{calls++;assert.deepEqual(input,{token_hash:token,type:'recovery'});return {error:null}}});
 assert((await action.confirmRecovery('bad')).error);assert.equal(calls,0);
 assert((await action.confirmRecovery(token)).success);assert.equal(calls,1);
 const expired=load('src/app/auth/confirm/actions.ts',{verifyOtp:async()=>({error:{message:'expired'}})});
 assert((await expired.confirmRecovery(token)).error);
 const offline=load('src/app/auth/confirm/actions.ts',{verifyOtp:async()=>{throw Error('network')}});
 assert((await offline.confirmRecovery(token)).error);
});
