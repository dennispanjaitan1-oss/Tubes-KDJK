import {test,expect} from '@playwright/test';
import {createHash,randomUUID} from 'node:crypto';
const API='http://localhost:4010/api';
test('API security, real DataChannel private/group, files, audio and reconnect',async({browser,request})=>{
  const tag=Date.now().toString(36),sessions=[],contexts=[],pages=[],errors=[],received=[[],[],[]];
  const call=(path,session,data,method='POST')=>request.fetch(API+path,{method,headers:session?{Authorization:`Bearer ${session.token}`}:{},...(data!==undefined?{data}:{})});
  await test.step('register, login validation and unauthorized API',async()=>{
    expect((await call('/users',null,undefined,'GET')).status()).toBe(401);
    expect((await call('/users',{token:'invalid'},undefined,'GET')).status()).toBe(401);
    expect((await call('/auth/register',null,{username:{},password:'123456',displayName:[]})).status()).toBe(400);
    for(let i=0;i<4;i++){
      const response=await call('/auth/register',null,{username:`audit_${tag}_${i}`,displayName:`Audit ${tag} ${i}`,password:'Audit-test-123!'});
      expect(response.status()).toBe(201);sessions.push(await response.json());
    }
    expect((await call('/auth/register',null,{username:sessions[0].user.username,displayName:'Duplicate',password:'Audit-test-123!'})).status()).toBe(409);
    expect((await call('/auth/login',null,{username:sessions[0].user.username,password:'wrong-password'})).status()).toBe(401);
    expect((await call('/auth/login',null,{username:'nonexistent_audit_user',password:'wrong-password'})).status()).toBe(401);
    const login=await call('/auth/login',null,{username:sessions[0].user.username,password:'Audit-test-123!'});expect(login.status()).toBe(200);
  });
  let cid;
  await test.step('contacts idempotency and simultaneous direct creation',async()=>{
    for(let i=0;i<2;i++)expect((await call('/contacts',sessions[0],{userId:sessions[1].user.id})).status()).toBe(200);
    const contacts=await (await call('/contacts',sessions[0],undefined,'GET')).json();expect(contacts.filter(x=>x.id===sessions[1].user.id)).toHaveLength(1);
    expect((await call('/contacts',sessions[0],{userId:2147483647})).status()).toBe(404);
    const responses=await Promise.all([call('/conversations/direct',sessions[0],{userId:sessions[1].user.id}),call('/conversations/direct',sessions[1],{userId:sessions[0].user.id})]);
    const ids=await Promise.all(responses.map(r=>r.json()));expect(ids[0].id).toBe(ids[1].id);cid=ids[0].id;
    expect((await call(`/conversations/${cid}/messages`,sessions[3],undefined,'GET')).status()).toBe(403);
    const msg={uuid:randomUUID(),conversationId:cid,kind:'text',body:'API idempotency',senderId:sessions[3].user.id};
    expect((await call('/messages',sessions[0],msg)).status()).toBe(201);
    expect((await call('/messages',sessions[0],msg)).status()).toBe(200);
    expect((await call('/messages',sessions[0],{...msg,body:'changed'})).status()).toBe(409);
    expect((await call('/messages',sessions[3],{...msg,uuid:randomUUID()})).status()).toBe(403);
    const history=await (await call(`/conversations/${cid}/messages`,sessions[0],undefined,'GET')).json();expect(history[0].senderId).toBe(sessions[0].user.id);
  });
  try{
    await test.step('three isolated browser sessions and DataChannel open',async()=>{
      for(let i=0;i<3;i++){
        const ctx=await browser.newContext({permissions:['microphone']});contexts.push(ctx);
        await ctx.addInitScript(session=>localStorage.setItem('nexa-session',JSON.stringify(session)),sessions[i]);
        await ctx.addInitScript(()=>{const Native=window.RTCPeerConnection;window.__pcs=[];window.__dcs=[];window.RTCPeerConnection=class extends Native{constructor(...a){super(...a);window.__pcs.push(this);this.addEventListener('datachannel',e=>window.__dcs.push(e.channel));}createDataChannel(...a){const channel=super.createDataChannel(...a);window.__dcs.push(channel);return channel;}};});
        const page=await ctx.newPage();pages.push(page);
        page.on('pageerror',e=>errors.push(e.message));
        page.on('console',m=>{if(m.text().includes('[NEXA DataChannel receive]'))received[i].push(m.text());if(m.text().includes('[NEXA WebRTC]'))console.log(m.text());});
        await page.goto('/');
      }
      await Promise.all(pages.slice(0,2).map((p,i)=>p.locator('.contact').filter({hasText:sessions[1-i].user.displayName}).click()));
      await Promise.all(pages.slice(0,2).map(p=>expect(p.locator('.chat-heading')).toContainText('P2P Connected',{timeout:25000})));
    });
    await test.step('bidirectional P2P while history GET is blocked',async()=>{
      for(const p of pages.slice(0,2))await p.route('**/api/conversations/*/messages',r=>r.abort());
      const texts=['P2P A → B 😀 <script> & "quotes"', 'P2P B → A', 'Long '+ 'x'.repeat(3500),'multiline\nsecond line 😀','burst 1','burst 2','burst 3'];
      for(let i=0;i<texts.length;i++){
        const sender=i===1?1:0,recipient=1-sender;
        await pages[sender].getByPlaceholder('Tulis pesan...').fill(texts[i]);await pages[sender].getByTitle('Kirim',{exact:true}).click();
        await expect(pages[recipient].locator('.bubble').filter({hasText:texts[i]})).toHaveCount(1);
      }
      expect(received[0].length).toBeGreaterThanOrEqual(1);expect(received[1].length).toBeGreaterThanOrEqual(5);
      await expect(pages[0].locator('.bubble').filter({hasText:'burst 3'})).toContainText('delivered');
    });
    await test.step('file chunks, SHA-256 download and oversize rejection',async()=>{
      const payload=Buffer.alloc(190000);for(let i=0;i<payload.length;i++)payload[i]=i%251;
      await pages[0].locator('input[type=file]').setInputFiles({name:'audit.bin',mimeType:'application/octet-stream',buffer:payload});
      const link=pages[1].getByRole('link',{name:'audit.bin'});await expect(link).toBeVisible();
      const href=await link.getAttribute('href');expect(createHash('sha256').update(Buffer.from(href.split(',')[1],'base64')).digest('hex')).toBe(createHash('sha256').update(payload).digest('hex'));
      const download=pages[1].waitForEvent('download');await link.click();expect((await download).suggestedFilename()).toBe('audit.bin');
      await pages[0].locator('input[type=file]').setInputFiles({name:'too-big.bin',mimeType:'application/octet-stream',buffer:Buffer.alloc(1500001)});
      await expect(pages[0].getByRole('status')).toContainText('Maksimum');
      await pages[0].locator('input[type=file]').setInputFiles({name:'second.txt',mimeType:'text/plain',buffer:Buffer.from('second transfer')});
      await expect(pages[1].getByRole('link',{name:'second.txt'})).toBeVisible();
      await pages[0].evaluate(cid=>{
        const ch=window.__dcs.find(c=>c.readyState==='open'),id=crypto.randomUUID();
        for(const packet of [{type:'media-start',id,kind:'file',name:'corrupt.bin',size:5,conversationId:cid,hash:'0'.repeat(64)},{type:'media-chunk',id,chunk:'data:application/octet-stream;base64,aGVsbG8='},{type:'media-end',id}])ch.send(JSON.stringify(packet));
      },cid);
      await expect(pages[1].getByRole('status')).toContainText('Integritas file gagal');await expect(pages[1].getByRole('link',{name:'corrupt.bin'})).toHaveCount(0);
    });
    await test.step('voice note with fake microphone, verified chunks and playable audio',async()=>{
      await pages[0].getByTitle('Rekam voice note').click();await expect(pages[0].getByTitle('Stop rekaman')).toBeVisible();
      await pages[0].waitForTimeout(1200);await pages[0].getByTitle('Stop rekaman').click();
      const audio=pages[1].locator('audio');await expect(audio).toHaveCount(1);
      await expect.poll(()=>audio.evaluate(a=>a.readyState)).toBeGreaterThanOrEqual(2);
      await audio.evaluate(a=>a.play());await expect.poll(()=>audio.evaluate(a=>a.currentTime)).toBeGreaterThan(0);
    });
    await test.step('database history after refresh and peer reconnect',async()=>{
      await pages[1].unroute('**/api/conversations/*/messages');await pages[1].reload();
      await pages[1].locator('.contact').filter({hasText:sessions[0].user.displayName}).click();
      await expect(pages[1].locator('.bubble').filter({hasText:'burst 3'})).toHaveCount(1);
      await expect(pages[1].locator('.chat-heading')).toContainText('P2P Connected',{timeout:25000});
      await pages[0].getByPlaceholder('Tulis pesan...').fill('after refresh');await pages[0].getByTitle('Kirim',{exact:true}).click();await expect(pages[1].locator('.bubble').filter({hasText:'after refresh'})).toHaveCount(1);
    });
    await test.step('group UI, three-node mesh and per-recipient delivery',async()=>{
      await pages[0].getByTitle('Buat grup',{exact:true}).click();await pages[0].getByPlaceholder('Contoh: Kelompok Tubes').fill('Audit Mesh '+tag);
      for(const i of [1,2])await pages[0].locator('.member-option').filter({hasText:sessions[i].user.displayName}).locator('input').check();
      await pages[0].getByRole('button',{name:'Buat grup (3 anggota)'}).click();
      for(const p of pages.slice(1))await p.locator('.contact').filter({hasText:'Audit Mesh '+tag}).click();
      for(const p of pages)await expect(p.locator('.chat-heading')).toContainText('P2P Connected',{timeout:25000});
      for(let i=0;i<3;i++){
        const text=`mesh message from ${i}`;await pages[i].getByPlaceholder('Tulis pesan...').fill(text);await pages[i].getByTitle('Kirim',{exact:true}).click();
        for(const p of pages)await expect(p.locator('.bubble').filter({hasText:text})).toHaveCount(1);
      }
      expect(received[2].length).toBeGreaterThanOrEqual(2);
      await pages[0].getByTitle('P2P Monitor',{exact:true}).click();await expect(pages[0].locator('.monitor-row')).toHaveCount(2);
      await expect(pages[0].locator('.monitor-row').first()).toContainText('DataChannel: open');
    });
    await test.step('offline/online recovery, responsive peers and logout',async()=>{
      await contexts[2].setOffline(true);
      expect(await pages[2].evaluate(async()=>{try{await fetch('http://localhost:4010/api/health');return 'reachable';}catch{return 'offline';}})).toBe('offline');
      // Network emulation blocks HTTP but does not cut an existing WebRTC path.
      // Close the page to explicitly exercise peer departure and mesh cleanup.
      await pages[2].close();await expect(pages[0].locator('.monitor-row')).toHaveCount(1,{timeout:15000});
      await pages[1].getByPlaceholder('Tulis pesan...').fill('group member offline');await pages[1].getByTitle('Kirim',{exact:true}).click();
      await expect(pages[1].locator('.bubble').filter({hasText:'group member offline'})).toContainText('stored');
      await contexts[2].setOffline(false);pages[2]=await contexts[2].newPage();pages[2].on('pageerror',e=>errors.push(e.message));await pages[2].goto('/');
      await pages[2].locator('.contact').filter({hasText:'Audit Mesh '+tag}).click();await expect(pages[2].locator('.chat-heading')).toContainText('P2P Connected',{timeout:30000});
      await expect(pages[2].locator('.bubble').filter({hasText:'group member offline'})).toHaveCount(1);
      const session=JSON.parse(await pages[2].evaluate(()=>localStorage.getItem('nexa-session')));
      const convs=await (await call('/conversations',session,undefined,'GET')).json();const group=convs.find(c=>c.title==='Audit Mesh '+tag);
      expect((await call(`/conversations/${group.id}/messages`,sessions[3],undefined,'GET')).status()).toBe(403);
      await pages[2].setViewportSize({width:390,height:844});await pages[2].getByTitle('Peers',{exact:true}).click();
      await expect(pages[2].locator('.contact').first().getByTitle('Mulai chat')).toBeVisible();
      await pages[2].getByTitle('Keluar',{exact:true}).click();await expect(pages[2].getByRole('button',{name:'Masuk',exact:true})).toBeVisible();
      expect(errors).toEqual([]);
    });
  }catch(e){console.log('Browser test failed:',e.message);for(const p of pages)console.log('RTC states',await p.evaluate(()=>window.__pcs.map(pc=>({state:pc.connectionState,ice:pc.iceConnectionState,signaling:pc.signalingState}))));throw e;}finally{await Promise.all(contexts.map(c=>c.close()));}
});
