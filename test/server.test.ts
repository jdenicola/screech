import {test, type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../server/index.js';

// HTTP regression tests; external services are deliberately replaced here.
async function fixture(t: TestContext, banned=false) {
  const queries: {sql:string;values:unknown[]}[]=[];
  let closed=false;
  const db={
    async query(sql:string,values:unknown[]=[]){
      queries.push({sql,values});
      if(sql.startsWith('SELECT * FROM channels'))return {rows:values[0]==='ABC123'?[{code:'ABC123',owner:'owner',expires:new Date(Date.now()+86400000),config:{maxClients:32,audioBitrate:32000,threshold:-40}}]:[]};
      if(sql.startsWith('INSERT INTO channels'))return {rowCount:1,rows:[{code:values[0],owner:values[1]}]};
      if(sql.startsWith('SELECT * FROM members'))return {rows:[{alias:'Operador',banned,blocked:false}]};
      return {rows:[]};
    },
    async end(){closed=true}
  };
  const calls: string[]=[];
  const livekit={
    async createRoom(){calls.push('createRoom')},
    async removeParticipant(){calls.push('removeParticipant')},
    async updateParticipant(){calls.push('updateParticipant')},
    async deleteRoom(){calls.push('deleteRoom')}
  };
  const app=await buildApp({db:db as any,livekit:livekit as any,logger:false});
  t.after(async()=>{await app.close();assert.equal(closed,true)});
  return {app,queries,calls};
}

test('configuration issues a reusable anonymous session cookie',async t=>{
  const {app}=await fixture(t);
  const response=await app.inject({url:'/api/config'});
  assert.equal(response.statusCode,200);
  assert.equal(response.json().productName,process.env.PRODUCT_NAME??'Screech');
  assert.match(response.headers['set-cookie'] as string,/sid=[a-f0-9]{48}.*HttpOnly.*SameSite=Lax/);
  assert.equal(response.headers['cache-control'],'no-store');
  const again=await app.inject({url:'/api/config',headers:{cookie:'sid=existing'}});
  assert.equal(again.headers['set-cookie'],undefined);
});

test('channel creation uses the anonymous session and a six-character code',async t=>{
  const {app,queries}=await fixture(t);
  const response=await app.inject({method:'POST',url:'/api/channels',headers:{cookie:'sid=owner'}});
  assert.equal(response.statusCode,200);
  assert.match(response.json().code,/^[A-Z0-9]{6}$/);
  assert.equal(queries.find(q=>q.sql.startsWith('INSERT INTO channels'))?.values[1],'owner');
});

test('channel lookup accepts lowercase and returns 404 for missing channels',async t=>{
  const {app}=await fixture(t);
  const found=await app.inject({url:'/api/channels/abc123'});
  assert.equal(found.statusCode,200);
  assert.equal(found.json().code,'ABC123');
  assert.equal((await app.inject({url:'/api/channels/ZZZZZZ'})).statusCode,404);
});

test('join issues an audio-only token with channel permissions',async t=>{
  const {app,calls}=await fixture(t);
  const response=await app.inject({method:'POST',url:'/api/channels/ABC123/join',headers:{cookie:'sid=owner'}});
  assert.equal(response.statusCode,200);
  const result=response.json();
  const claims=JSON.parse(Buffer.from(result.token.split('.')[1],'base64url').toString());
  assert.equal(result.owner,true);
  assert.equal(claims.sub,'owner');
  assert.equal(claims.video.room,'ABC123');
  assert.equal(claims.video.canPublishData,false);
  assert.deepEqual(claims.video.canPublishSources,['microphone']);
  assert.deepEqual(calls,['createRoom']);
});

test('moderation requires ownership and protects the owner',async t=>{
  const {app,calls}=await fixture(t);
  for(const [session,target] of [['visitor','member'],['owner','owner']]){
    const response=await app.inject({method:'POST',url:`/api/channels/ABC123/participants/${target}/moderation`,headers:{cookie:`sid=${session}`},payload:{action:'kick'}});
    assert.equal(response.statusCode,403);
  }
  assert.deepEqual(calls,[]);
});

test('malformed and foreign origins are rejected before a mutation',async t=>{
  const {app,queries}=await fixture(t);
  for(const origin of ['https://foreign.example','null','%%%']){
    const response=await app.inject({method:'POST',url:'/api/channels',headers:{origin}});
    assert.equal(response.statusCode,403);
  }
  assert.equal(queries.filter(q=>q.sql.startsWith('INSERT')).length,0);
  assert.equal((await app.inject({method:'POST',url:'/api/channels',headers:{origin:'http://localhost:3001',host:'localhost:3001'}})).statusCode,200);
});

test('webhook rejects missing or invalid signatures',async t=>{
  const {app,calls}=await fixture(t);
  const response=await app.inject({method:'POST',url:'/api/webhooks/livekit',headers:{'content-type':'application/webhook+json'},payload:'{"event":"participant_joined"}'});
  assert.equal(response.statusCode,401);
  assert.deepEqual(calls,[]);
});


test('expelled sessions cannot obtain another token',async t=>{
  const {app,calls}=await fixture(t,true);
  const response=await app.inject({method:'POST',url:'/api/channels/ABC123/join',headers:{cookie:'sid=visitor'}});
  assert.equal(response.statusCode,403);
  assert.deepEqual(calls,[]);
});

test('owner can block, allow and kick another participant',async t=>{
  const {app,calls,queries}=await fixture(t);
  for(const action of ['block','allow','kick']){
    const response=await app.inject({method:'POST',url:'/api/channels/ABC123/participants/member/moderation',headers:{cookie:'sid=owner'},payload:{action}});
    assert.equal(response.statusCode,200);
  }
  assert.deepEqual(calls,['updateParticipant','updateParticipant','removeParticipant']);
  assert.deepEqual(queries.filter(q=>q.sql.startsWith('UPDATE members')).map(q=>q.values.slice(2)),[[false,true],[false,false],[true,true]]);
});
