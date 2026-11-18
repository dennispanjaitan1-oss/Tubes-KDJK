import React,{useCallback,useEffect,useRef,useState} from 'react';
import {io} from 'socket.io-client';
import {PeerLink,summarizeStats,validUuid,checksum} from './p2p.js';
import {MessageCircle,Users,Network,Settings,Search,Plus,Send,Mic,Paperclip,Sun,Moon,LogOut,Wifi,Check,CheckCheck,ArrowLeft,Activity,UserPlus,Square,Download,X,RefreshCw} from 'lucide-react';

const API=import.meta.env.VITE_API_URL||'http://localhost:4000';
const STUN=[{urls:'stun:stun.l.google.com:19302'}];
const classNames=(...x)=>x.filter(Boolean).join(' ');
const stamp=d=>{try{return new Date(d).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});}catch{return '';}};
const initialSession=()=>{try{const s=JSON.parse(localStorage.getItem('nexa-session')||'null');return s?.user?.id&&typeof s.token==='string'?s:null;}catch{return null;}};
const initials=x=>(x||'?').split(' ').slice(0,2).map(s=>s[0]?.toUpperCase()).join('');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

function App(){
 const [session,setSession]=useState(initialSession),[loginMode,setLoginMode]=useState('login');
 const [credentials,setCredentials]=useState({username:'',displayName:'',password:''});
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[tab,setTab]=useState('chats');
 const [users,setUsers]=useState([]),[contacts,setContacts]=useState([]),[conversations,setConversations]=useState([]),[selected,setSelected]=useState(null);
 const [messages,setMessages]=useState([]),[draft,setDraft]=useState(''),[search,setSearch]=useState('');
 const [online,setOnline]=useState([]),[peerStates,setPeerStates]=useState({}),[stats,setStats]=useState({});
 const [groupOpen,setGroupOpen]=useState(false),[groupTitle,setGroupTitle]=useState(''),[groupMembers,setGroupMembers]=useState([]);
 const [dark,setDark]=useState(localStorage.getItem('nexa-theme')!=='light'),[recording,setRecording]=useState(false),[typing,setTyping]=useState({});
 const [signaling,setSignaling]=useState(false);
 const [reply,setReply]=useState(null),[notice,setNotice]=useState('');
 const socketRef=useRef(null),peersRef=useRef(new Map()),selectedRef=useRef(null),conversationRef=useRef([]),mediaRef=useRef(new Map());
 const blobsRef=useRef(new Map()),recorderRef=useRef(null),bottomRef=useRef(null),sessionRef=useRef(session),refreshRef=useRef(null),onlineRef=useRef([]),acksRef=useRef(new Map());
 onlineRef.current=online;sessionRef.current=session;selectedRef.current=selected;conversationRef.current=conversations;
 const api=useCallback(async(path,method='GET',data=null)=>{
   const token=sessionRef.current?.token;
   const resp=await fetch(API+'/api'+path,{method,signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(data?{body:JSON.stringify(data)}:{})});
   const json=await resp.json().catch(()=>({}));if(resp.status===401&&token&&sessionRef.current?.token===token){localStorage.removeItem('nexa-session');setSession(null);setSelected(null);setMessages([]);setConversations([]);}if(!resp.ok)throw new Error(json.error||`HTTP ${resp.status}`);return json;
 },[]);
 const alertErr=e=>setNotice(e?.message||String(e));
 const getLists=useCallback(async()=>{
   if(!sessionRef.current)return;
   const token=sessionRef.current.token;try{const [u,c,co]=await Promise.all([api('/users'),api('/contacts'),api('/conversations')]);if(sessionRef.current?.token!==token)return;conversationRef.current=co;setUsers(u);setContacts(c);setConversations(co);}catch(e){alertErr(e);}
 },[api]);
 refreshRef.current=getLists;
 const loadMessages=useCallback(async(id)=>{
   try{const rows=await api(`/conversations/${id}/messages`);if(selectedRef.current?.id===id)setMessages(old=>{
     const pending=old.filter(m=>Number(m.conversationId)===id&&!rows.some(r=>r.uuid===m.uuid));return [...rows.map(r=>({...r,delivery:'stored',...old.find(m=>m.uuid===r.uuid)})),...pending].sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));
   });}catch(e){alertErr(e);}
 },[api]);
 const setPeerStatus=(id,state)=>setPeerStates(o=>({...o,[id]:state}));
 const notifyReceive=(message)=>{
   const current=selectedRef.current;
   if(current?.id===Number(message.conversationId))setMessages(old=>old.some(m=>m.uuid===message.uuid)?old:[...old,message]);
   else setNotice('Pesan baru masuk. Buka percakapan untuk melihatnya.');
 };
 const handleChannelData=async(from,raw)=>{
   const token=sessionRef.current?.token;
   if(typeof raw!=='string'||raw.length>20000)return;let d;try{d=JSON.parse(raw);}catch{return;}if(!d||typeof d!=='object')return;
   if(d.type==='typing') {if(typeof d.active==='boolean')setTyping(t=>({...t,[from]:d.active?Date.now():false}));return;}
   if(d.type==='chat'){
     setTyping(t=>({...t,[from]:false}));
     const m=d.message;
     if(!m||Number(m.senderId)!==Number(from)||!validUuid(m.uuid)||m.kind!=='text'||typeof m.body!=='string'||!m.body.trim()||m.body.length>4000||m.replyTo!=null&&!validUuid(m.replyTo))return;
     const allowed=conversationRef.current.some(c=>c.id===Number(m.conversationId)&&c.members.some(u=>u.id===Number(from)));
     if(!allowed)return;
     console.info('[NEXA DataChannel receive]',{from,uuid:m.uuid,conversationId:m.conversationId});
     notifyReceive({uuid:m.uuid,conversationId:Number(m.conversationId),senderId:Number(from),kind:'text',body:m.body,replyTo:m.replyTo||null,createdAt:new Date().toISOString(),transport:'datachannel'});
     const ch=peersRef.current.get(from)?.channel;if(ch?.readyState==='open')ch.send(JSON.stringify({type:'ack',uuid:m.uuid}));
   }
   if(d.type==='ack'){const receipt=acksRef.current.get(d.uuid);if(receipt?.expected.has(from)){receipt.received.add(from);if(receipt.received.size===receipt.expected.size){setMessages(ms=>ms.map(m=>m.uuid===d.uuid?{...m,delivery:'delivered'}:m));acksRef.current.delete(d.uuid);}}}
   if(d.type==='media-start'){
     if(!validUuid(d.id)||!['voice','file'].includes(d.kind)||!Number.isInteger(d.size)||d.size<1||d.size>1500000||typeof d.name!=='string'||d.name.length>255||!/^[a-f0-9]{64}$/.test(d.hash||'')||!conversationRef.current.some(c=>c.id===Number(d.conversationId)&&c.members.some(u=>u.id===from))||mediaRef.current.size>=10)return;
     mediaRef.current.set(from+':'+d.id,{...d,chunks:[],length:0,start:Date.now()});
   }
   if(d.type==='media-chunk'){
     const k=from+':'+d.id,obj=mediaRef.current.get(k);
     if(!obj)return;if(obj.chunks.length>=170||typeof d.chunk!=='string'||d.chunk.length>12000||obj.length+d.chunk.length>2000300){mediaRef.current.delete(k);return;}
     obj.length+=d.chunk.length;obj.chunks.push(d.chunk);
   }
   if(d.type==='media-end'){
     const k=from+':'+d.id,obj=mediaRef.current.get(k);if(!obj)return;
     mediaRef.current.delete(k);
     const url=obj.chunks.join('');
     if(!/^data:[a-z0-9.+/-]*(?:;codecs=[a-z0-9., -]+)?;base64,[a-zA-Z0-9+/=]+$/i.test(url)||url.length>2000300)return;
     const verified=await checksum(url);if(sessionRef.current?.token!==token)return;if(verified.size!==obj.size||verified.hash!==obj.hash){setNotice('Integritas file gagal; transfer dibuang.');return;}
     // Never render HTML/SVG received from a peer as an active document.
     const safeUrl=obj.kind==='voice'&&url.startsWith('data:audio/')?url:'data:application/octet-stream;base64,'+url.split(',')[1];
     if(blobsRef.current.size>=20)blobsRef.current.delete(blobsRef.current.keys().next().value);
     blobsRef.current.set(from+':'+obj.id,safeUrl);
     const msg={uuid:obj.id,conversationId:obj.conversationId,senderId:from,kind:obj.kind,body:obj.name||'Voice note',createdAt:new Date().toISOString(),localMedia:safeUrl,transport:'datachannel'};
     notifyReceive(msg);const ch=peersRef.current.get(from)?.channel;if(ch?.readyState==='open')ch.send(JSON.stringify({type:'ack',uuid:obj.id}));
   }
 };
 const setupPeer=(userId,isInitiator=false)=>{
   userId=Number(userId);let peer=peersRef.current.get(userId);
   if(!peer||peer.closed||peer.pc.signalingState==='closed'){
     peer=new PeerLink({userId,localId:sessionRef.current.user.id,iceServers:STUN,
       signal:(kind,data)=>socketRef.current?.emit('signal',{to:userId,kind,data}),
       receive:raw=>handleChannelData(userId,raw),status:state=>setPeerStatus(userId,state)});
     peersRef.current.set(userId,peer);
   }
   if(isInitiator)peer.start();return peer;
 };
 const connectTo=async(uid)=>{
   let peer=peersRef.current.get(Number(uid));
   if(peer?.channel?.readyState==='open')return peer.channel;
   if(peer&&(peer.pc.connectionState==='failed'||peer.channel?.readyState==='closed')){peer.close();peersRef.current.delete(Number(uid));}
   setupPeer(uid,true);setPeerStatus(uid,'connecting');return null;
 };
 const awaitChannel=async(uid)=>{
   let p=peersRef.current.get(Number(uid));
   if(!p||!p.channel||p.channel.readyState==='closed'||p.pc.connectionState==='failed'||p.pc.signalingState==='closed')await connectTo(uid);
   for(let i=0;i<60;i++){p=peersRef.current.get(Number(uid));if(p?.channel?.readyState==='open')return p.channel;await sleep(150);}
   return null;
 };
 useEffect(()=>{
   if(!session)return;
   api('/me').catch(alertErr);getLists();
   const socket=io(API,{auth:{token:session.token},transports:['websocket','polling']});socketRef.current=socket;
   socket.on('presence:list',ids=>setOnline(ids));
   socket.on('presence:change',p=>{if(!p.online){peersRef.current.get(p.userId)?.close();peersRef.current.delete(p.userId);setPeerStatus(p.userId,'offline');}setOnline(o=>p.online?[...new Set([...o,p.userId])]:o.filter(x=>x!==p.userId));});
   socket.on('connect',()=>{setSignaling(true);refreshRef.current?.();});
   socket.on('disconnect',()=>{setSignaling(false);setOnline([]);for(const p of peersRef.current.values())p.close();peersRef.current.clear();setPeerStates({});});
   socket.on('session:replaced',()=>{logout();setNotice('Akun ini aktif di sesi lain. Gunakan satu tab per akun untuk demo P2P.');});
   let incoming=Promise.resolve();
   socket.on('signal',payload=>{incoming=incoming.then(async()=>{
     if(!socket.connected||socketRef.current!==socket)return;
     const {from,fromSession,kind,data}=payload;
     if(!conversationRef.current.some(c=>c.members.some(u=>u.id===Number(from))))await refreshRef.current?.();
     if(!conversationRef.current.some(c=>c.members.some(u=>u.id===Number(from))))return;
     const old=peersRef.current.get(Number(from));
     if(old?.remoteSession&&old.remoteSession!==fromSession){old.close();peersRef.current.delete(Number(from));}
     const peer=setupPeer(from);peer.remoteSession=fromSession;
     await peer.handleSignal(kind,data);
   }).catch(e=>setNotice('Signaling: '+e.message));});
   socket.on('conversation:new',()=>refreshRef.current?.());
   socket.on('connect_error',e=>setNotice('Signaling: '+e.message));
   const ticker=setInterval(async()=>{
     const out={};for(const [id,p] of peersRef.current){
       try{out[id]=summarizeStats(await p.pc.getStats());
       }catch{}
     }setTyping(old=>Object.fromEntries(Object.entries(old).filter(([,time])=>time&&Date.now()-time<5000)));for(const [key,m] of mediaRef.current)if(Date.now()-m.start>60000)mediaRef.current.delete(key);
     for(const [key,a] of acksRef.current)if(Date.now()-a.start>60000)acksRef.current.delete(key);setStats(out);
   },3000);
   return()=>{clearInterval(ticker);socket.disconnect();socketRef.current=null;for(const p of peersRef.current.values())p.close();peersRef.current.clear();mediaRef.current.clear();blobsRef.current.clear();acksRef.current.clear();const r=recorderRef.current;if(r){r.onstop=null;if(r.state!=='inactive')r.stop();r.stream.getTracks().forEach(t=>t.stop());}setRecording(false);setOnline([]);setStats({});setTyping({});setPeerStates({});};
 },[session?.token]);
 useEffect(()=>{if(selected){setMessages([]);loadMessages(selected.id);setReply(null);for(const m of selected.members.filter(x=>x.id!==session?.user.id))if(online.includes(m.id))connectTo(m.id).catch(console.warn);}},[selected?.id]);
 useEffect(()=>{if(!session)return;for(const c of conversations)for(const m of c.members)if(m.id!==session.user.id&&online.includes(m.id))connectTo(m.id).catch(alertErr);for(const [id,p] of peersRef.current)if(!online.includes(id)){p.close();peersRef.current.delete(id);setPeerStatus(id,'offline');}},[online.join(','),conversations.map(c=>c.id).join(',')]);
 useEffect(()=>{bottomRef.current?.scrollIntoView({behavior:'smooth'});},[messages.length,selected?.id]);
 useEffect(()=>{localStorage.setItem('nexa-theme',dark?'dark':'light');},[dark]);
 useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>setNotice(''),6000);return()=>clearTimeout(timer);},[notice]);
 useEffect(()=>{if(tab!=='peers'||!session)return;let active=true;const timer=setTimeout(()=>api('/users?q='+encodeURIComponent(search)).then(rows=>{if(active)setUsers(rows);}).catch(e=>{if(active)alertErr(e);}),250);return()=>{active=false;clearTimeout(timer);};},[tab,search,session?.token,api]);
 useEffect(()=>()=>{const recorder=recorderRef.current;if(recorder&&recorder.state!=='inactive'){recorder.onstop=null;recorder.stop();recorder.stream.getTracks().forEach(t=>t.stop());setRecording(false);}},[selected?.id]);
 const login=async(e)=>{
   e.preventDefault();setError('');setBusy(true);
   try{const response=await api(`/auth/${loginMode}`,'POST',credentials);localStorage.setItem('nexa-session',JSON.stringify(response));setSession(response);}
   catch(e){setError(e.message);}finally{setBusy(false);}
 };
 const logout=()=>{localStorage.removeItem('nexa-session');setSession(null);setSelected(null);setConversations([]);setMessages([]);setUsers([]);setContacts([]);setDraft('');setReply(null);setGroupOpen(false);};
 const openDirect=async(target)=>{
   try{const r=await api('/conversations/direct','POST',{userId:target.id});await getLists();const cs=await api('/conversations');setConversations(cs);setSelected(cs.find(x=>x.id===r.id));setTab('chats');}
   catch(e){alertErr(e);}
 };
 const addContact=async(u)=>{try{await api('/contacts','POST',{userId:u.id});await getLists();setNotice(u.displayName+' ditambahkan sebagai peer.');}catch(e){alertErr(e);}};
 const createGroup=async()=>{
   try{const r=await api('/conversations/group','POST',{title:groupTitle,memberIds:groupMembers});const cs=await api('/conversations');setConversations(cs);setSelected(cs.find(x=>x.id===r.id));setTab('chats');setGroupOpen(false);setGroupTitle('');setGroupMembers([]);}
   catch(e){alertErr(e);}
 };
 const sendText=async(e)=>{
   e?.preventDefault();const text=draft.trim(),c=selected;if(!text||!c||!session)return;const token=session.token;
   setDraft('');setReply(null);
   for(const member of c.members.filter(x=>x.id!==session.user.id)){const ch=peersRef.current.get(member.id)?.channel;if(ch?.readyState==='open')ch.send(JSON.stringify({type:'typing',active:false}));}
   const msg={uuid:crypto.randomUUID(),conversationId:c.id,senderId:session.user.id,kind:'text',body:text,replyTo:reply?.uuid||null,createdAt:new Date().toISOString(),delivery:'pending'};
   acksRef.current.set(msg.uuid,{expected:new Set(c.members.filter(m=>m.id!==session.user.id).map(m=>m.id)),received:new Set(),start:Date.now()});setMessages(m=>[...m,msg]);
   try{await api('/messages','POST',msg);
     const ids=c.members.filter(m=>m.id!==session.user.id).map(m=>m.id);
     const results=await Promise.all(ids.map(async id=>{
       if(sessionRef.current?.token!==token||!onlineRef.current.includes(id))return false;
       const channel=await awaitChannel(id);
       if(channel&&sessionRef.current?.token===token){channel.send(JSON.stringify({type:'chat',message:msg}));return true;}return false;
     }));
     setMessages(ms=>ms.map(x=>x.uuid===msg.uuid?{...x,delivery:x.delivery==='delivered'?'delivered':results.every(Boolean)?'sent':'stored'}:x));
   }catch(e){setMessages(ms=>ms.map(x=>x.uuid===msg.uuid?{...x,delivery:'error'}:x));alertErr(e);}
 };
 const sendFile=async(file,kind='file')=>{
   const c=selected;if(!file||!c||!session)return;const token=session.token;
   if(!crypto.subtle){setNotice('Transfer file terverifikasi membutuhkan HTTPS atau localhost.');return;}
   if(file.size<1||file.size>1_500_000){setNotice('Maksimum file 1,5 MB untuk demo P2P.');return;}
   const reader=new FileReader();
   reader.onload=async()=>{
     let id;try{
     if(sessionRef.current?.token!==token)return;const url=String(reader.result);id=crypto.randomUUID();blobsRef.current.set(session.user.id+':'+id,url);const digest=await checksum(url);if(sessionRef.current?.token!==token)return;const expected=c.members.filter(m=>m.id!==session.user.id).map(m=>m.id);acksRef.current.set(id,{expected:new Set(expected),received:new Set(),start:Date.now()});
     const msg={uuid:id,conversationId:c.id,senderId:session.user.id,kind,body:kind==='voice'?'Voice note':file.name,createdAt:new Date().toISOString(),localMedia:url,delivery:'pending'};
     if(selectedRef.current?.id===c.id)setMessages(ms=>[...ms,msg]);
       const recipients=c.members.filter(m=>m.id!==session.user.id&&onlineRef.current.includes(m.id));
       const channels=(await Promise.all(recipients.map(m=>awaitChannel(m.id)))).filter(Boolean);if(sessionRef.current?.token!==token)return;
       if(!channels.length){setNotice('Tidak ada peer terhubung untuk menerima file/voice note.');setMessages(ms=>ms.map(m=>m.uuid===id?{...m,delivery:'not sent'}:m));return;}
       await api('/messages','POST',{...msg,localMedia:undefined});
       for(const channel of channels){
         channel.send(JSON.stringify({type:'media-start',id,kind,name:file.name,size:file.size,hash:digest.hash,conversationId:c.id}));
         for(let i=0;i<url.length;i+=12000){
           const deadline=Date.now()+15000;while(channel.bufferedAmount>256000){if(channel.readyState!=='open'||Date.now()>deadline||sessionRef.current?.token!==token)throw new Error('Transfer terputus atau timeout.');await sleep(40);}
           channel.send(JSON.stringify({type:'media-chunk',id,chunk:url.slice(i,i+12000)}));
           setMessages(ms=>ms.map(m=>m.uuid===id?{...m,progress:Math.min(100,Math.round((i+12000)/url.length*100))}:m));
         }
         channel.send(JSON.stringify({type:'media-end',id}));
       }
       // Only metadata is persisted; actual binary remains local/peer-side.
       setMessages(ms=>ms.map(m=>m.uuid===id?{...m,delivery:m.delivery==='delivered'?'delivered':channels.length===expected.length?'sent':'partial'}:m));
     }catch(e){setMessages(ms=>ms.map(m=>m.uuid===id?{...m,delivery:'error'}:m));alertErr(e);}
   };reader.onerror=()=>setNotice('File gagal dibaca.');reader.readAsDataURL(file);
 };
 const toggleRecording=async()=>{
   if(recording){recorderRef.current?.stop();return;}
   if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined'){setNotice('Rekaman membutuhkan browser pendukung dan HTTPS/localhost.');return;}
   const targetId=selectedRef.current?.id,token=sessionRef.current?.token;
   let stream;try{stream=await navigator.mediaDevices.getUserMedia({audio:true});
     if(sessionRef.current?.token!==token||selectedRef.current?.id!==targetId){stream.getTracks().forEach(t=>t.stop());return;}
     const mime=MediaRecorder.isTypeSupported('audio/webm')?'audio/webm':'';
     const recorder=new MediaRecorder(stream,mime?{mimeType:mime}:{}),parts=[];
     recorderRef.current=recorder;recorder.onerror=()=>{stream.getTracks().forEach(t=>t.stop());setRecording(false);setNotice('Rekaman audio gagal.');};recorder.ondataavailable=e=>{if(e.data.size)parts.push(e.data);if(parts.reduce((n,p)=>n+p.size,0)>1500000&&recorder.state==='recording')recorder.stop();};
     recorder.onstop=()=>{setRecording(false);stream.getTracks().forEach(t=>t.stop());const blob=new Blob(parts,{type:recorder.mimeType||'audio/webm'});sendFile(new File([blob],`voice-${Date.now()}.webm`,{type:blob.type}),'voice');};
     recorder.start(1000);setRecording(true);
   }catch(e){stream?.getTracks().forEach(t=>t.stop());alertErr(new Error('Mikrofon tidak tersedia: '+e.message));}
 };
 const beginTyping=()=>{if(!selected)return;for(const m of selected.members.filter(x=>x.id!==session.user.id)){const ch=peersRef.current.get(m.id)?.channel;if(ch?.readyState==='open')ch.send(JSON.stringify({type:'typing',active:true}));}};
 const cName=c=>c.type==='group'?c.title:(c.members.find(m=>m.id!==session.user.id)?.displayName||'Chat');
 const currentOther=selected?.members.filter(x=>x.id!==session?.user.id)||[];
 const currentStatus=currentOther.length?currentOther.every(x=>peerStates[x.id]==='connected')?'P2P Connected':currentOther.some(x=>peerStates[x.id]==='connecting')?'Connecting':currentOther.some(x=>online.includes(x.id))?'Available':'Offline':'—';
 const displayMessages=messages;
 if(!session)return <div className={classNames('app',dark&&'dark',(tab==='monitor'||tab==='settings'||tab==='chats'&&selected)&&'show-main')}><div className="auth-wrap"><div className="auth-hero"><div className="logo big"><Network size={32}/> NEXA</div><h1>Chat langsung.<br/>Koneksi lebih dekat.</h1><p>Messenger peer-to-peer dengan WebRTC, grup kecil, voice note, dan monitoring koneksi langsung.</p><div className="auth-visual"><div className="node">A</div><span>← P2P →</span><div className="node">B</div></div></div><form className="auth-card" onSubmit={login}><div className="eyebrow">NEXA MESSENGER</div><h2>{loginMode==='login'?'Selamat datang':'Buat akun baru'}</h2><p className="muted">{loginMode==='login'?'Masuk untuk mulai terhubung.':'Bergabung dengan jaringan peer.'}</p>{loginMode==='register'&&<label>Nama tampilan<input required maxLength={80} placeholder="Nama kamu" value={credentials.displayName} onChange={e=>setCredentials({...credentials,displayName:e.target.value})}/></label>}<label>Username<input required placeholder="misalnya andi_01" value={credentials.username} onChange={e=>setCredentials({...credentials,username:e.target.value})}/></label><label>Password<input type="password" required minLength={6} placeholder="Minimal 6 karakter" value={credentials.password} onChange={e=>setCredentials({...credentials,password:e.target.value})}/></label>{error&&<div className="alert">{error}</div>}<button className="primary full" disabled={busy}>{busy?'Memproses...':loginMode==='login'?'Masuk':'Daftar'}</button><p className="auth-switch">{loginMode==='login'?'Belum punya akun? ':'Sudah punya akun? '}<button type="button" className="link" onClick={()=>{setError('');setLoginMode(loginMode==='login'?'register':'login');}}>{loginMode==='login'?'Daftar sekarang':'Login'}</button></p></form></div></div>;
 return <div className={classNames('app',dark&&'dark',(tab==='monitor'||tab==='settings'||tab==='chats'&&selected)&&'show-main')}>
 <aside className="rail"><div className="brand"><Network size={25}/><span>NEXA</span></div><nav><button title="Chats" className={tab==='chats'?'active':''} onClick={()=>setTab('chats')}><MessageCircle/></button><button title="Peers" className={tab==='peers'?'active':''} onClick={()=>setTab('peers')}><Users/></button><button title="P2P Monitor" className={tab==='monitor'?'active':''} onClick={()=>setTab('monitor')}><Activity/></button><button title="Pengaturan" className={tab==='settings'?'active':''} onClick={()=>setTab('settings')}><Settings/></button></nav><div className="rail-bottom"><button title="Ganti tema" onClick={()=>setDark(!dark)}>{dark?<Sun/>:<Moon/>}</button><button title="Keluar" onClick={logout}><LogOut/></button><div className="avatar mine">{initials(session.user.displayName)}</div></div></aside>
 <div className="sidebar"><div className="side-head"><div className="eyebrow">WORKSPACE</div><div className="side-title"><h2>{tab==='chats'?'Messages':tab==='peers'?'Peers':tab==='monitor'?'Network':'Settings'}</h2><button className="icon-btn" onClick={()=>tab==='chats'?setGroupOpen(true):getLists()} title={tab==='chats'?'Buat grup':'Refresh'}>{tab==='chats'?<Plus size={20}/>:<RefreshCw size={19}/>}</button></div><div className="searchbox"><Search size={18}/><input placeholder={tab==='peers'?'Cari username...':'Cari percakapan...'} value={search} onChange={e=>setSearch(e.target.value)}/></div></div>
 {tab==='chats'?<div className="side-list"><div className="section-label">PERCAKAPAN <span>{conversations.length}</span></div>{conversations.filter(c=>cName(c).toLowerCase().includes(search.toLowerCase())).map(c=><button key={c.id} className={classNames('contact',selected?.id===c.id&&'chosen')} onClick={()=>setSelected(c)}><div className={classNames('avatar',c.type==='group'&&'group-avatar')}>{c.type==='group'?<Users size={20}/>:initials(cName(c))}</div><div className="person"><strong>{cName(c)}</strong><small>{c.type==='group'?`${c.members.length} anggota`:'Direct message'}</small></div><span className="contact-meta">{c.type==='group'?'GRUP':online.includes(c.members.find(m=>m.id!==session.user.id)?.id)?'●':''}</span></button>)}{!conversations.length&&<div className="empty-small">Belum ada chat. Buka menu Peers untuk memulai.</div>}</div>:tab==='peers'?<div className="side-list"><div className="section-label">SEMUA PEER <span>{users.length}</span></div>{users.filter(u=>(u.username+' '+u.displayName).toLowerCase().includes(search.toLowerCase())).map(u=><div className="contact" key={u.id}><div className="avatar">{initials(u.displayName)}</div><div className="person"><strong>{u.displayName}</strong><small>@{u.username} · {online.includes(u.id)?'Online':'Offline'}</small></div><button className="mini-button" title="Tambah peer" onClick={()=>addContact(u)}><UserPlus size={17}/></button><button className="mini-button" title="Mulai chat" onClick={()=>openDirect(u)}><MessageCircle size={17}/></button></div>)}</div>:<div className="side-list"><div className="section-label">STATUS</div><div className="side-info"><div className="status-dot"/> {signaling?'Signaling connected':'Reconnecting...'}<p>WebRTC DataChannel adalah jalur utama pertukaran pesan.</p></div></div>}
 <div className="side-footer"><span className="status-dot"/><span>{online.length} peer online</span></div></div>
 <main className="main">
 {tab==='monitor'?<div className="panel scroll"><div className="panel-head"><div className="eyebrow">LIVE MONITOR</div><h1>P2P Network Inspector</h1><p>Data diambil dari koneksi WebRTC browser (getStats) setiap 3 detik.</p></div><div className="stats-grid"><div className="stat-card"><Network/><strong>{[...peersRef.current.values()].filter(p=>p.channel?.readyState==='open').length}</strong><small>DataChannels aktif</small></div><div className="stat-card"><Users/><strong>{online.length}</strong><small>Peer online</small></div><div className="stat-card"><Wifi/><strong>{Object.keys(peerStates).length}</strong><small>Koneksi pernah dicoba</small></div></div><h3>Koneksi antar-peer</h3><div className="monitor-list">{[...peersRef.current.entries()].map(([id,p])=><div className="monitor-row" key={id}><div className="avatar">{initials(users.find(u=>u.id===id)?.displayName)}</div><div className="person"><strong>{users.find(u=>u.id===id)?.displayName||`Peer #${id}`}</strong><small>ICE: {p.pc.iceConnectionState} · DataChannel: {p.channel?.readyState||'none'}</small></div><span className={classNames('pill',p.channel?.readyState==='open'?'green':'amber')}>{peerStates[id]||'new'}</span><div className="monitor-num">{stats[id]?.rtt??'N/A'} ms RTT<br/>{stats[id]?.sent??'N/A'} B sent · {stats[id]?.received??'N/A'} B recv<br/>Peer #{id} · {stats[id]?.route||'N/A'}<br/>Pair: {stats[id]?.pair||'N/A'}<br/>Retries: {p.attempts} · Error: {p.lastError||'N/A'}</div></div>)}{peersRef.current.size===0&&<p className="muted">Belum ada koneksi. Buka chat dengan peer yang online untuk membuat koneksi WebRTC.</p>}</div><div className="tip"><Network/> Perhatikan: data P2P dapat melewati TURN relay jika jaringan tidak mendukung koneksi langsung. Demo ini mengonfigurasi STUN saja, sehingga beberapa jaringan tidak bisa terhubung.</div></div>
 :tab==='settings'?<div className="panel scroll"><div className="panel-head"><div className="eyebrow">ACCOUNT</div><h1>Pengaturan NEXA</h1></div><div className="setting-card"><div className="avatar mine large">{initials(session.user.displayName)}</div><div><h3>{session.user.displayName}</h3><p>@{session.user.username}</p><p className="muted">User ID: {session.user.id}</p></div></div><div className="setting-card"><span>Mode tampilan</span><button className="secondary" onClick={()=>setDark(!dark)}>{dark?'☀ Light':'☾ Dark'}</button></div><div className="tip">NEXA Demo v1.0 · Login JWT · WebRTC DataChannel · Socket.IO signaling · MySQL.</div></div>
 :tab==='peers'?<div className="panel scroll"><div className="panel-head"><div className="eyebrow">DISCOVER</div><h1>Temukan & hubungkan peer</h1><p>Pilih salah satu pengguna dari daftar kiri, tambahkan peer, lalu mulai percakapan.</p></div><div className="stats-grid"><div className="stat-card"><Users/><strong>{users.length}</strong><small>Total pengguna lain</small></div><div className="stat-card"><Wifi/><strong>{online.length}</strong><small>Sedang online</small></div><div className="stat-card"><UserPlus/><strong>{contacts.length}</strong><small>Peer ditambahkan</small></div></div><h3>Kontak tersimpan</h3><div className="peer-grid">{contacts.map(u=><button key={u.id} className="peer-tile" onClick={()=>openDirect(u)}><div className="avatar">{initials(u.displayName)}</div><strong>{u.displayName}</strong><small>@{u.username}</small><span className={classNames('pill',online.includes(u.id)?'green':'muted-pill')}>{online.includes(u.id)?'Online':'Offline'}</span></button>)}</div></div>
 :selected?<><header className="chat-header"><button className="icon-btn mobile-back" title="Kembali ke daftar chat" onClick={()=>setSelected(null)}><ArrowLeft size={19}/></button><div className={classNames('avatar',selected.type==='group'&&'group-avatar')}>{selected.type==='group'?<Users size={20}/>:initials(cName(selected))}</div><div className="chat-heading"><strong>{cName(selected)}</strong><small><span className={classNames('status-dot',currentStatus==='P2P Connected'?'':'yellow')}/>{currentStatus} · {selected.members.length} member</small></div><div className="header-actions"><button className="icon-btn" title="Buka monitor" onClick={()=>setTab('monitor')}><Activity size={19}/></button><button className="icon-btn" title="Coba hubungkan ulang" onClick={()=>currentOther.forEach(u=>connectTo(u.id).catch(alertErr))}><RefreshCw size={19}/></button></div></header><div className="chat-messages"><div className="secure-banner"><Wifi size={15}/> Chat aktif dikirim melalui WebRTC DataChannel. Riwayat teks disimpan ke MySQL.</div>{displayMessages.map((m,i)=>{const mine=Number(m.senderId)===session.user.id;const sender=selected.members.find(x=>x.id===Number(m.senderId));const media=m.localMedia||blobsRef.current.get(m.senderId+':'+m.uuid);return <div key={m.uuid||i} className={classNames('message-line',mine&&'own')}><div className={classNames('bubble',mine&&'my-bubble')}>{selected.type==='group'&&!mine&&<div className="sender-name">{sender?.displayName||'Peer'}</div>}{m.replyTo&&<div className="reply-preview">↪ membalas pesan {m.replyTo.slice(0,8)}</div>}{m.kind==='voice'?media?<audio controls src={media}/>:<span>🎙 Voice note (audio hanya tersedia saat sesi transfer)</span>:m.kind==='file'?media?<a download={m.body} href={media} className="file-link"><Download size={16}/> {m.body}</a>:<span>📎 {m.body} (file tidak tersedia di sesi ini)</span>:<span>{m.body}</span>}<div className="msg-meta"><button title="Balas pesan" onClick={()=>setReply(m)}>↩</button><span>{stamp(m.createdAt)}</span>{mine&&<span title={m.delivery||'tersimpan'}>{m.delivery==='delivered'?<CheckCheck size={14}/>:<Check size={14}/>} {m.delivery||'stored'}{m.progress!=null&&m.delivery==='pending'? String(m.progress)+'%':''}</span>}</div></div></div>})}{currentOther.some(x=>typing[x.id])&&<div className="typing">Peer sedang mengetik...</div>}<div ref={bottomRef}/></div><div className="composer-wrap">{reply&&<div className="reply-box"><span>Membalas: {reply.body.slice(0,80)}</span><button className="icon-btn" onClick={()=>setReply(null)}><X size={16}/></button></div>}<form className="composer" onSubmit={sendText}><label className="attach-btn" title="Kirim file P2P"><Paperclip size={19}/><input type="file" hidden onChange={e=>{sendFile(e.target.files?.[0]);e.target.value='';}}/></label><textarea rows={2} value={draft} maxLength={4000} onChange={e=>{setDraft(e.target.value);beginTyping();}} placeholder="Tulis pesan..."/><button type="button" title={recording?'Stop rekaman':'Rekam voice note'} className={classNames('icon-btn',recording&&'recording')} onClick={toggleRecording}>{recording?<Square size={19}/>:<Mic size={19}/>}</button><button className="send-btn" type="submit" title="Kirim" disabled={!draft.trim()}><Send size={20}/></button></form><div className="composer-note">{recording?'● Merekam... klik kotak untuk menghentikan.':'P2P terenkripsi transport · File/voice note maksimal 1,5 MB'}</div></div></>
 :<div className="welcome"><div className="welcome-mark"><Network size={48}/></div><h1>Welcome to NEXA</h1><p>Pesan lebih dekat dengan teknologi Peer-to-Peer. Mulai percakapan lewat menu Peers, atau buat grup baru.</p><button className="primary" onClick={()=>setTab('peers')}><Users size={18}/> Cari peer</button></div>}
 </main>
 {groupOpen&&<div className="modal-back" onClick={()=>setGroupOpen(false)}><div className="modal" onClick={e=>e.stopPropagation()}><div className="modal-title"><h2>Buat grup P2P</h2><button className="icon-btn" onClick={()=>setGroupOpen(false)}><X/></button></div><p className="muted">Pilih 2–4 anggota selain kamu untuk membuat grup mesh (3–5 orang).</p><label>Nama grup<input maxLength={100} placeholder="Contoh: Kelompok Tubes" value={groupTitle} onChange={e=>setGroupTitle(e.target.value)}/></label><div className="member-list">{users.map(u=><label key={u.id} className="member-option"><input type="checkbox" checked={groupMembers.includes(u.id)} disabled={!groupMembers.includes(u.id)&&groupMembers.length>=4} onChange={e=>setGroupMembers(a=>e.target.checked?[...a,u.id]:a.filter(x=>x!==u.id))}/><span>{u.displayName} <small>@{u.username}</small></span></label>)}</div><button className="primary full" disabled={!groupTitle.trim()||groupMembers.length<2} onClick={createGroup}>Buat grup ({groupMembers.length+1} anggota)</button></div></div>}
 {notice&&<div className="toast" role="status" aria-live="polite"><span>{notice}</span><button onClick={()=>setNotice('')}><X size={16}/></button></div>}
 </div>;
}
export default App;
