import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import httpProxy from '@fastify/http-proxy';
import staticFiles from '@fastify/static';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import rateLimit from '@fastify/rate-limit';
import {openDatabase, type Database} from './database.js';
import {randomBytes,randomInt} from 'node:crypto';
import {AccessToken,RoomServiceClient,WebhookReceiver} from 'livekit-server-sdk';
export async function buildApp(deps: {db?: Database; livekit?: Pick<RoomServiceClient,'createRoom'|'removeParticipant'|'updateParticipant'|'deleteRoom'>; logger?: boolean} = {}) {
const app=Fastify({logger:deps.logger===false?false:{serializers:{req:(req:any)=>({method:req.method,url:req.url?.split('?')[0],host:req.headers?.host,remoteAddress:req.ip})}}});
await app.register(cookie); await app.register(rateLimit,{max:60,timeWindow:'1 minute'});
const db=deps.db??openDatabase();
const num=(key:string,fallback:number,min:number,max:number)=>{const n=Number(process.env[key]??fallback);if(!Number.isFinite(n)||n<min||n>max)throw Error(key);return n};
const config={audioBitrate:num('AUDIO_BITRATE_BPS',32000,6000,510000),maxClients:num('CHANNEL_MAX_CLIENTS',32,1,1000),ttl:num('CHANNEL_TTL_SECONDS',86400,60,604800),threshold:num('VAD_THRESHOLD_DBFS',-40,-60,-10),dtx:process.env.AUDIO_DTX_ENABLED!=='false',red:process.env.AUDIO_RED_ENABLED!=='false'};
const productName=(process.env.PRODUCT_NAME??'Screech').trim();if(!productName)throw Error('PRODUCT_NAME');
const lk=deps.livekit??new RoomServiceClient(process.env.LIVEKIT_URL??'http://localhost:7880',process.env.LIVEKIT_API_KEY??'devkey',process.env.LIVEKIT_API_SECRET??'local-development-secret-change-me-32');
await db.query(`CREATE TABLE IF NOT EXISTS channels(code text PRIMARY KEY, owner text NOT NULL, expires text NOT NULL, config text NOT NULL); CREATE TABLE IF NOT EXISTS members(code text REFERENCES channels(code), identity text, alias text, banned integer DEFAULT 0, blocked integer DEFAULT 0, PRIMARY KEY(code,identity))`);
app.addHook('onRequest',async(req,reply)=>{reply.header('Cache-Control','no-store');if(req.method!=='GET'&&req.headers.origin){let originHost;try{originHost=new URL(req.headers.origin).host}catch{return reply.code(403).send({error:'Origen inválido'})}if(originHost!==req.headers.host)return reply.code(403).send({error:'Origen inválido'});}if(!req.cookies.sid){const sid=randomBytes(24).toString('hex');reply.setCookie('sid',sid,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:604800});req.cookies.sid=sid;}});
if(process.env.LIVEKIT_PROXY_ENABLED==='true')await app.register(httpProxy,{upstream:process.env.LIVEKIT_URL??'http://127.0.0.1:7880',prefix:'/livekit',websocket:true,httpMethods:['GET']});
const receiver=new WebhookReceiver(process.env.LIVEKIT_API_KEY??'devkey',process.env.LIVEKIT_API_SECRET??'local-development-secret-change-me-32');
app.addContentTypeParser('application/webhook+json',{parseAs:'string'},(_req,body,done)=>done(null,body));
app.post('/api/webhooks/livekit',async(req,reply)=>{try{const event=await receiver.receive(req.body as string,req.headers.authorization);if(event.event==='participant_joined'&&event.room&&event.participant){const code=event.room.name,id=event.participant.identity;const {rows}=await db.query('SELECT m.banned,m.blocked,c.expires FROM members m JOIN channels c ON m.code=c.code WHERE m.code=$1 AND m.identity=$2',[code,id]);const m=rows[0];if(!m||m.banned||new Date(m.expires).getTime()<=Date.now())await lk.removeParticipant(code,id);else if(m.blocked)await lk.updateParticipant(code,id,{permission:{canPublish:false,canSubscribe:true,canPublishData:false}});}return {ok:true}}catch{ return reply.code(401).send({error:'Webhook inválido'});}});
app.get('/api/config',()=>({productName}));
app.get('/manifest.webmanifest',()=>({name:productName,short_name:productName,start_url:'/',display:'standalone',background_color:'#171916',theme_color:'#ef9e32'}));
async function channel(code:string){const {rows}=await db.query("SELECT * FROM channels WHERE code=$1 AND expires>strftime('%Y-%m-%dT%H:%M:%fZ','now')",[code.toUpperCase()]);if(!rows[0])throw Object.assign(Error('Canal inexistente o vencido'),{statusCode:404});return rows[0];}
app.post('/api/channels',async(req)=>{for(let i=0;i<10;i++){const code=Array.from({length:6},()=> 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'[randomInt(36)]).join('');const r=await db.query('INSERT INTO channels VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING *',[code,req.cookies.sid,new Date(Date.now()+config.ttl*1000).toISOString(),config]);if(r.rowCount)return r.rows[0];}throw Error('No se pudo crear canal');});
app.get('/api/channels/:code',async(req)=>{const c=await channel((req.params as any).code);return {code:c.code,expires:c.expires,config:c.config};});
app.post('/api/channels/:code/join',async(req,reply)=>{const c=await channel((req.params as any).code),id=req.cookies.sid!;const savedAlias=typeof(req.body as any)?.alias==='string'?(req.body as any).alias.trim().slice(0,32):'';await db.query('INSERT INTO members(code,identity,alias) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[c.code,id,savedAlias||`Operador ${randomInt(1000)}`]);const {rows:[m]}=await db.query('SELECT * FROM members WHERE code=$1 AND identity=$2',[c.code,id]);if(m.banned)return reply.code(403).send({error:'Sesión expulsada'});if(savedAlias&&savedAlias!==m.alias){await db.query('UPDATE members SET alias=$3 WHERE code=$1 AND identity=$2',[c.code,id,savedAlias]);m.alias=savedAlias;}await lk.createRoom({name:c.code,maxParticipants:c.config.maxClients,emptyTimeout:300,departureTimeout:300});const token=new AccessToken(process.env.LIVEKIT_API_KEY??'devkey',process.env.LIVEKIT_API_SECRET??'local-development-secret-change-me-32',{identity:id,name:m.alias,ttl:'2m'});token.addGrant({roomJoin:true,room:c.code,canPublish:!m.blocked,canSubscribe:true,canPublishData:false,canPublishSources:[2]});return {alias:m.alias,token:await token.toJwt(),url:process.env.LIVEKIT_PUBLIC_URL??'ws://localhost:7880',identity:id,owner:c.owner===id,config:c.config};});
app.patch('/api/channels/:code/me',async(req)=>{const c=await channel((req.params as any).code);const alias=String((req.body as any)?.alias??'').trim().slice(0,32);if(!alias)throw Object.assign(Error('Alias requerido'),{statusCode:400});await db.query('UPDATE members SET alias=$3 WHERE code=$1 AND identity=$2',[c.code,req.cookies.sid,alias]);await lk.updateParticipant(c.code,req.cookies.sid!,{name:alias});return {ok:true};});
app.post('/api/channels/:code/participants/:id/moderation',async(req,reply)=>{const {code,id}=req.params as any,c=await channel(code);if(c.owner!==req.cookies.sid||id===c.owner)return reply.code(403).send({error:'No autorizado'});const action=(req.body as any)?.action;if(!['block','allow','kick'].includes(action))return reply.code(400).send({error:'Acción inválida'});await db.query('UPDATE members SET banned=$3,blocked=$4 WHERE code=$1 AND identity=$2',[c.code,id,action==='kick',action!=='allow']);if(action==='kick')await lk.removeParticipant(c.code,id);else await lk.updateParticipant(c.code,id,{permission:{canPublish:action==='allow',canSubscribe:true,canPublishData:false}});return {ok:true};});
const expiryTimer=setInterval(async()=>{try{const {rows}=await db.query("SELECT code FROM channels WHERE expires<=strftime('%Y-%m-%dT%H:%M:%fZ','now')");for(const c of rows){await lk.deleteRoom(c.code).catch(()=>{});}}catch(e){app.log.error(e)}},10000).unref();
if(existsSync(resolve('web/dist'))){await app.register(staticFiles,{root:resolve('web/dist')});app.setNotFoundHandler((req,reply)=>(req.url.startsWith('/api/')||req.url.startsWith('/livekit')||!['GET','HEAD'].includes(req.method))?reply.code(404).send({error:'No encontrado'}):reply.sendFile('index.html'));}
app.addHook('onClose',async()=>{clearInterval(expiryTimer);await db.end()});
return app;
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
const app=await buildApp();
for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>{void app.close()});
await app.listen({host:'0.0.0.0',port:3001});
}
