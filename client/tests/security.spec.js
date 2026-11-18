import {test,expect} from '@playwright/test';
import {io} from 'socket.io-client';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(new URL('../../server/package.json',import.meta.url));
const jwt=require('jsonwebtoken');
require('dotenv').config({path:fileURLToPath(new URL('../../server/.env',import.meta.url))});
const ROOT='http://localhost:4010';
test('expired JWT, malformed JSON, payload limits and signaling identity/authorization',async({request})=>{
  const expired=jwt.sign({id:1},process.env.JWT_SECRET,{expiresIn:-10});
  expect((await request.get(ROOT+'/api/me',{headers:{Authorization:'Bearer '+expired}})).status()).toBe(401);
  expect((await request.post(ROOT+'/api/auth/login',{headers:{'Content-Type':'application/json'},data:'{bad'})).status()).toBe(400);
  expect((await request.post(ROOT+'/api/auth/login',{data:{username:'x'.repeat(90000)}})).status()).toBe(413);
  const sessions=[];const sockets=[];
  const tag=Date.now().toString(36);
  for(let i=0;i<2;i++){
    const r=await request.post(ROOT+'/api/auth/register',{data:{username:`signal_${tag}_${i}`,displayName:'Signal Audit',password:'Audit-test-123!'}});expect(r.status()).toBe(201);sessions.push(await r.json());
  }
  const connect=token=>new Promise((resolve,reject)=>{
    const s=io(ROOT,{auth:{token},reconnection:false,timeout:4000});sockets.push(s);s.on('connect',()=>resolve(s));s.on('connect_error',reject);
  });
  try{
    await expect(connect('invalid')).rejects.toThrow('Unauthorized');
    const [a,b]=await Promise.all(sessions.map(s=>connect(s.token)));const signals=[];b.on('signal',s=>signals.push(s));
    a.emit('signal',null);a.emit('signal',{});
    const payload={to:sessions[1].user.id,kind:'offer',data:{type:'offer',sdp:'v=0'},from:sessions[1].user.id};
    a.emit('signal',payload);await new Promise(r=>setTimeout(r,250));expect(signals).toHaveLength(0);
    await request.post(ROOT+'/api/conversations/direct',{headers:{Authorization:'Bearer '+sessions[0].token},data:{userId:sessions[1].user.id}});
    a.emit('signal',payload);await expect.poll(()=>signals.length).toBe(1);expect(signals[0].from).toBe(sessions[0].user.id);expect(signals[0].fromSession).toBe(a.id);
    const replaced=new Promise(resolve=>a.once('session:replaced',resolve));await connect(sessions[0].token);await replaced;await expect.poll(()=>a.connected).toBe(false);
  }finally{for(const s of sockets)s.disconnect();}
});
