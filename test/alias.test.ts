import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildApp} from '../server/index.js';
import {openDatabase} from '../server/database.js';

test('joining restores a normalized operator name in SQLite and in the token, across channels',async()=>{
  const db=openDatabase(':memory:');
  const livekit={async createRoom(){},async removeParticipant(){},async updateParticipant(){},async deleteRoom(){}} as any;
  const app=await buildApp({db,livekit,logger:false});
  try{
    const created=await app.inject({method:'POST',url:'/api/channels',headers:{cookie:'sid=owner'}});
    const {code}=created.json();
    const join=async(alias?:unknown)=>app.inject({method:'POST',url:`/api/channels/${code}/join`,headers:{cookie:'sid=operator'},payload:alias===undefined?{}:{alias}});
    const generated=await join();
    assert.match(generated.json().alias,/^Operador \d+$/);
    const restored=await join('  Operador persistente  ');
    assert.equal(restored.statusCode,200);
    assert.equal(restored.json().alias,'Operador persistente');
    assert.equal(JSON.parse(Buffer.from(restored.json().token.split('.')[1],'base64url').toString()).name,'Operador persistente');
    assert.equal((await db.query('SELECT alias FROM members WHERE code=$1 AND identity=$2',[code,'operator'])).rows[0].alias,'Operador persistente');
    assert.equal((await join('   ')).json().alias,'Operador persistente');
    assert.equal((await join(123)).json().alias,'Operador persistente');
    const long=await join('N'.repeat(40));
    assert.equal(long.json().alias,'N'.repeat(32));
    const second=await app.inject({method:'POST',url:'/api/channels',headers:{cookie:'sid=operator'}});
    const next=await app.inject({method:'POST',url:`/api/channels/${second.json().code}/join`,headers:{cookie:'sid=operator'},payload:{alias:'Operador persistente'}});
    assert.equal(next.json().alias,'Operador persistente');
    assert.equal(next.json().owner,true);
    await app.inject({method:'POST',url:`/api/channels/${code}/participants/operator/moderation`,headers:{cookie:'sid=owner'},payload:{action:'kick'}});
    assert.equal((await join('Otro nombre')).statusCode,403);
    assert.equal((await db.query('SELECT alias FROM members WHERE code=$1 AND identity=$2',[code,'operator'])).rows[0].alias,'N'.repeat(32));
  }finally{await app.close()}
});
