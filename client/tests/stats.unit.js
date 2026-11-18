import {test} from 'node:test';
import assert from 'node:assert/strict';
import {summarizeStats,checksum} from '../src/p2p.js';
test('route uses selected transport pair, never an unused TURN candidate',()=>{
  const report=new Map([
    ['t',{type:'transport',selectedCandidatePairId:'active'}],
    ['active',{id:'active',type:'candidate-pair',localCandidateId:'local',remoteCandidateId:'remote',currentRoundTripTime:0.012}],
    ['local',{type:'local-candidate',candidateType:'host'}],
    ['remote',{type:'remote-candidate',candidateType:'srflx'}],
    ['unused',{type:'local-candidate',candidateType:'relay'}],
    ['dc',{type:'data-channel',bytesSent:50,bytesReceived:100}]
  ]);
  assert.deepEqual(summarizeStats(report),{sent:50,received:100,rtt:12,route:'host → srflx',pair:'active'});
});
test('missing browser stats remain unavailable rather than fabricated zero',()=>{
  assert.deepEqual(summarizeStats(new Map()),{sent:null,received:null,rtt:null,route:'N/A',pair:'N/A'});
});
test('SHA-256 measures decoded bytes and detects changed content',async()=>{
  const a=await checksum('data:application/octet-stream;base64,aGVsbG8=');
  assert.equal(a.size,5);assert.equal(a.hash,'2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  assert.notEqual((await checksum('data:application/octet-stream;base64,aGVsbGE=')).hash,a.hash);
});
