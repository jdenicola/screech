// Manual integration check against the exact signaling code shipped in the web SDK.
// Run with Node >=22: node --import tsx scripts/check-signal.ts https://your-domain
import {SignalClient} from '../node_modules/livekit-client/src/api/SignalClient.ts';
const base=process.argv[2]??'http://127.0.0.1:3001';
const headers={'ngrok-skip-browser-warning':'1'};
const config=await fetch(base+'/api/config',{headers});
const cookie=config.headers.get('set-cookie')?.split(';')[0];
if(!cookie)throw Error('No se recibió cookie de sesión');
const sessionHeaders={...headers,cookie,origin:base};
const created=await fetch(base+'/api/channels',{method:'POST',headers:sessionHeaders});
if(!created.ok)throw Error('Creación HTTP '+created.status);
const {code}=await created.json();
const joined=await fetch(base+`/api/channels/${code}/join`,{method:'POST',headers:sessionHeaders});
if(!joined.ok)throw Error('Join HTTP '+joined.status);
const {url,token}=await joined.json();
const client=new SignalClient();
try {
  const result=await client.join(process.argv[3]??url,token,{autoSubscribe:true,maxRetries:0,e2eeEnabled:false,websocketTimeout:10000});
  if(!result.room?.sid||!result.participant?.sid)throw Error('Respuesta de señalización incompleta');
  console.log(JSON.stringify({ok:true,channel:code,serverVersion:result.serverInfo?.version,transport:'SDK /rtc/v1'}));
}finally{await client.close();}
