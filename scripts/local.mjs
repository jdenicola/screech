import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {existsSync} from 'node:fs';
import {buildApp} from '../server/index.ts';
const binary=process.env.LIVEKIT_BINARY??'.local/bin/livekit-server';
if(!existsSync(binary))throw Error(`Falta LiveKit: ${binary}. Instala el binario como indica README.md.`);
const child=spawn(process.execPath,['scripts/livekit.mjs'],{stdio:'inherit',env:process.env});
let app,stopping=false;
async function stop(){
  if(stopping)return;
  stopping=true;
  await app?.close();
  if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{void stop()});
child.on('exit',()=>{if(!stopping){process.exitCode=1;void stop()}});
try {
  let ready=false;
  for(let i=0;i<100&&!stopping;i++){
    try {const response=await fetch('http://127.0.0.1:7880',{signal:AbortSignal.timeout(500)});if(response.ok){ready=true;break}}catch{}
    await delay(100);
  }
  if(!ready)throw Error('LiveKit no inició en el puerto 7880');
  app=await buildApp();
  await app.listen({host:'0.0.0.0',port:3001});
  console.log('Screech: http://localhost:3001 — SQLite; Redis '+(process.env.REDIS_ENABLED==='true'?'activado':'apagado'));
} catch(error){console.error(error);process.exitCode=1;await stop();}
