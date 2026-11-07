import {test} from 'node:test';
import assert from 'node:assert/strict';
import {livekitConfig} from '../scripts/livekit-config.mjs';
test('Redis is omitted by default and when disabled',()=>{
  assert.equal(livekitConfig({}).redis,undefined);
  assert.equal(livekitConfig({REDIS_ENABLED:'false',REDIS_ADDRESS:'unused:6379'}).redis,undefined);
});
test('Redis requires an address and uses configured credentials',()=>{
  assert.throws(()=>livekitConfig({REDIS_ENABLED:'true'}),/REDIS_ADDRESS/);
  assert.throws(()=>livekitConfig({REDIS_ENABLED:'yes'}),/REDIS_ENABLED/);
  assert.deepEqual(livekitConfig({REDIS_ENABLED:'true',REDIS_ADDRESS:'cache:6379',REDIS_PASSWORD:'secret'}).redis,{address:'cache:6379',password:'secret'});
});


test('external TURN is omitted unless configured and supports ephemeral credentials',()=>{
  assert.equal(livekitConfig({}).rtc.turn_servers,undefined);
  assert.deepEqual(livekitConfig({TURN_HOST:'turn.example.com',TURN_SHARED_SECRET:'test-secret'}).rtc.turn_servers,[{host:'turn.example.com',port:443,protocol:'tls',secret:'test-secret'}]);
  assert.deepEqual(livekitConfig({TURN_HOST:'turn.example.com',TURN_PORT:'3478',TURN_PROTOCOL:'udp',TURN_USERNAME:'test',TURN_CREDENTIAL:'password'}).rtc.turn_servers,[{host:'turn.example.com',port:3478,protocol:'udp',username:'test',credential:'password'}]);
});
test('TURN rejects incomplete credentials and invalid transport configuration',()=>{
  assert.throws(()=>livekitConfig({TURN_HOST:'turn.example.com'}),/TURN requiere/);
  assert.throws(()=>livekitConfig({TURN_HOST:'turn.example.com',TURN_PORT:'0'}),/TURN_PORT/);
  assert.throws(()=>livekitConfig({TURN_HOST:'turn.example.com',TURN_PROTOCOL:'https'}),/TURN_PROTOCOL/);
});
