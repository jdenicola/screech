import {test} from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import {buildApp} from '../server/index.js';
import {openDatabase} from '../server/database.js';
import {createRequire} from 'node:module';
const {WebSocketServer}=createRequire(import.meta.url)('ws');

test('public LiveKit prefix reaches upstream without exposing server API paths',async()=>{
  const upstream=Fastify();
  const sockets=new WebSocketServer({server:upstream.server});
  sockets.on('connection',(socket:any,req:any)=>{socket.send(req.url)});
  upstream.get('/rtc/validate',req=>({path:req.url}));
  const url=await upstream.listen({host:'127.0.0.1',port:0});
  const previous={proxy:process.env.LIVEKIT_PROXY_ENABLED,url:process.env.LIVEKIT_URL};
  process.env.LIVEKIT_PROXY_ENABLED='true';process.env.LIVEKIT_URL=url;
  let app;
  try{
    app=await buildApp({db:openDatabase(':memory:'),logger:false});
    const response=await app.inject({url:'/livekit/rtc/validate?test=1'});
    assert.equal(response.statusCode,200);
    assert.equal(response.json().path,'/rtc/validate?test=1');
    const address=await app.listen({host:'127.0.0.1',port:0});
    const socket=new WebSocket(address.replace('http://','ws://')+'/livekit/rtc?test=1');
    try {
      const message=await new Promise<string>((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('WebSocket timeout')),3000);
        socket.onmessage=e=>{clearTimeout(timer);resolve(String(e.data))};
        socket.onerror=()=>{clearTimeout(timer);reject(Error('WebSocket failed'))};
      });
      assert.equal(message,'/rtc?test=1');
    } finally {socket.close();}
    assert.equal((await app.inject({method:'POST',url:'/livekit/twirp/livekit.RoomService/ListRooms',payload:{}})).statusCode,404);
  }finally{
    await app?.close();for(const socket of sockets.clients)socket.terminate();sockets.close();await upstream.close();
    for(const [key,value] of [['LIVEKIT_PROXY_ENABLED',previous.proxy],['LIVEKIT_URL',previous.url]]){
      if(value===undefined)delete process.env[key!];else process.env[key!]=value;
    }
  }
});
