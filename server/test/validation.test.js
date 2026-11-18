import {test} from 'node:test';
import assert from 'node:assert/strict';
import {credentialsValid,messageValid,signalValid,createLimiter} from '../src/validation.js';
test('reject untyped and oversized credentials before SQL/bcrypt',()=>{
  for(const body of [null,{}, {username:[],password:'123456'}, {username:'user',password:{}}])assert.ok(!credentialsValid(body));
  assert.ok(credentialsValid({username:'audit_user',password:'123456',displayName:'Name'},true));
  assert.ok(!credentialsValid({username:'audit_user',password:'😀'.repeat(19)}));
  assert.ok(!credentialsValid({username:'audit_user',password:'123456',displayName:[]},true));
});
test('validate UUID, text limit, membership identifier and reply shape',()=>{
  const msg={uuid:'d18be315-69f0-4488-839d-e819e1e2e215',conversationId:1,body:'hello 😀'};
  assert.ok(messageValid(msg));
  for(const change of [{uuid:'-'.repeat(36)},{conversationId:-1},{body:[]},{body:'x'.repeat(4001)},{replyTo:{}},{kind:'html'}])assert.ok(!messageValid({...msg,...change}));
});
test('reject malformed signaling and permit ICE and SDP',()=>{
  for(const p of [undefined,null,{}, {to:1,kind:'offer',data:{type:'answer',sdp:'bad'}}, {to:1,kind:'ice',data:{}}])assert.ok(!signalValid(p));
  assert.ok(signalValid({to:2,kind:'ice',data:{candidate:'candidate:...'}}));
  assert.ok(signalValid({to:2,kind:'offer',data:{type:'offer',sdp:'v=0'}}));
});
test('rate limiter bounds traffic and restores quota after window',()=>{
  const allow=createLimiter(2,100,2);
  assert.ok(allow('a',0));assert.ok(allow('a',1));assert.ok(!allow('a',2));
  assert.ok(allow('b',3));assert.ok(!allow('c',4));assert.ok(allow('c',101));assert.ok(allow('a',104));
});
