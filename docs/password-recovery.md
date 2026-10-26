# Recuperação de senha

A tela de login oferece **Esqueci minha senha**. O usuário solicita o link em
`/auth/recover`, abre o e-mail no mesmo navegador e define a senha em
`/auth/update-password`. O callback troca o código PKCE por uma sessão Supabase.
Após a troca da senha, a sessão local é encerrada e o usuário volta ao login.

A origem canônica padrão é `https://comercial-simpledev.vercel.app`.
`APP_URL` permite sobrescrever esse valor para outro ambiente. Pré-visualizações
redirecionam a solicitação para a origem canônica, preservando o navegador que
armazenará o verificador PKCE.

No Supabase Auth, autorize a URL de retorno `/auth/callback` dessa origem.
Se o provedor usar o Site URL principal como alternativa, o middleware encaminha
seu parâmetro `code` para o callback. O Site URL deve apontar para o CRM correto.

Verificação automatizada: `node --test scripts/password-recovery.test.cjs`.
Verificação de aceite: solicitar o link de uma conta controlada, recebê-lo e abrir
no mesmo navegador; o próprio usuário deve escolher e confirmar a nova senha.
Não registrar códigos, senhas ou links de recuperação nos logs.

Recuperação assistida: um administrador pode gerar um link de recuperação para
uma conta existente usando `auth.admin.generateLink`. Isso não envia e-mail.
Entregar o `hashed_token` em `/auth/confirm#token_hash=...` por um canal privado.
A página remove o fragmento do histórico e só verifica o token após confirmação
explícita. O servidor aceita apenas o tipo `recovery`; a senha continua sendo
escolhida e enviada pelo próprio usuário. Nunca expor a chave administrativa
no navegador nem criar um endpoint público para gerar esses links.
