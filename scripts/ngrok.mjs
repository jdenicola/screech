import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
const binary=process.env.NGROK_BINARY??'.local/bin/ngrok';
if(!existsSync(binary))throw Error(`Falta ngrok en ${binary}`);
if(!process.env.NGROK_AUTHTOKEN)throw Error('Configura NGROK_AUTHTOKEN en .env desde el dashboard de ngrok. No se usa login ni callback a localhost.');
const children=[];
let stopping=false;
function stop(){if(stopping)return;stopping=true;for(const child of children)child.kill('SIGTERM');}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,stop);
function start(command,args,env=process.env){
  const child=spawn(command,args,{stdio:'inherit',env});
  children.push(child);
  child.on('error',error=>{console.error(error.message);process.exitCode=1;stop()});
  child.on('exit',code=>{if(!stopping){process.exitCode=code??1;stop()}});
  return child;
}
try {
  mkdirSync('.local',{recursive:true});
  writeFileSync('.local/ngrok.yml','version: 3\nagent:\n  web_addr: 127.0.0.1:4040\n',{mode:0o600});
  const args=['http','http://127.0.0.1:3001','--log=stderr','--log-format=json','--config=.local/ngrok.yml'];
  if(process.env.NGROK_DOMAIN)args.push('--url=https://'+process.env.NGROK_DOMAIN);
  start(binary,args);
  let publicUrl;
  for(let i=0;i<150&&!stopping;i++){
    try {
      const response=await fetch('http://127.0.0.1:4040/api/tunnels',{signal:AbortSignal.timeout(500)});
      const data=await response.json();
      publicUrl=data.tunnels?.find(t=>t.public_url?.startsWith('https://'))?.public_url;
      if(publicUrl)break;
    }catch{}
    await delay(100);
  }
  if(!publicUrl)throw Error('ngrok no proporcionó una URL HTTPS; revisa credenciales y conexión.');
  start(process.execPath,['--import','tsx','scripts/local.mjs'],{
    ...process.env,LIVEKIT_PROXY_ENABLED:'true',
    LIVEKIT_PUBLIC_URL:publicUrl.replace('https://','wss://')+'/livekit',
    LIVEKIT_USE_EXTERNAL_IP:process.env.NGROK_USE_EXTERNAL_IP??'true'
  });
  console.log(`URL pública de Screech: ${publicUrl}`);
  console.log('HTTPS y señalización WSS comparten túnel. El audio necesita acceso al SFU por UDP 7882/TCP 7881 o TURN.');
}catch(error){console.error(error.message);process.exitCode=1;stop();}
