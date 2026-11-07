import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {buildApp} from '../server/index.js';
import {openDatabase} from '../server/database.js';

test('SQLite persists channels, aliases and bans across restart and rejects expired channels',async()=>{
  const directory=mkdtempSync(join(tmpdir(),'screech-db-test-'));
  const filename=join(directory,'test.sqlite');
  const livekit={async createRoom(){},async removeParticipant(){},async updateParticipant(){},async deleteRoom(){}} as any;
  let app:Awaited<ReturnType<typeof buildApp>>|undefined;
  try {
    let db=openDatabase(filename);
    app=await buildApp({db,livekit,logger:false});
    const created=await app.inject({method:'POST',url:'/api/channels',headers:{cookie:'sid=owner'}});
    assert.equal(created.statusCode,200);
    const {code}=created.json();
    for(const identity of ['owner','member']){
      assert.equal((await app.inject({method:'POST',url:`/api/channels/${code}/join`,headers:{cookie:`sid=${identity}`}})).statusCode,200);
    }
    const alias=await app.inject({method:'PATCH',url:`/api/channels/${code}/me`,headers:{cookie:'sid=member'},payload:{alias:'Probador'}});
    assert.equal(alias.statusCode,200);
    const kick=await app.inject({method:'POST',url:`/api/channels/${code}/participants/member/moderation`,headers:{cookie:'sid=owner'},payload:{action:'kick'}});
    assert.equal(kick.statusCode,200);
    await app.close();
    app=undefined;
    db=openDatabase(filename);
    app=await buildApp({db,livekit,logger:false});
    const lookup=await app.inject({url:`/api/channels/${code}`});
    assert.equal(lookup.statusCode,200);
    assert.equal(lookup.json().config.maxClients,32);
    assert.equal((await db.query('SELECT * FROM members WHERE code=$1 AND identity=$2',[code,'member'])).rows[0].alias,'Probador');
    assert.equal((await app.inject({method:'POST',url:`/api/channels/${code}/join`,headers:{cookie:'sid=member'}})).statusCode,403);
    await db.query('UPDATE channels SET expires=$2 WHERE code=$1',[code,'2000-01-01T00:00:00.000Z']);
    assert.equal((await app.inject({url:`/api/channels/${code}`})).statusCode,404);
    assert.equal((await db.query("SELECT code FROM channels WHERE expires<=strftime('%Y-%m-%dT%H:%M:%fZ','now')")).rows.length,1);
  } finally {await app?.close();rmSync(directory,{recursive:true,force:true});}
});
