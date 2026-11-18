import 'dotenv/config';
import {positiveId,credentialsValid,messageValid,signalValid,createLimiter} from './validation.js';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mysql from 'mysql2/promise';
import { createServer } from 'node:http';
import { Server } from 'socket.io';

const PORT = Number(process.env.PORT || 4000);
const ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 24) {
  throw new Error('Set JWT_SECRET at least 24 characters in server/.env');
}
const db = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'nexa_p2p',
  waitForConnections: true, connectionLimit: 10
});
const app = express();
app.disable('x-powered-by');
app.use((_req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');next();});
const authLimit=createLimiter(30,60000),apiLimit=createLimiter(600,60000);
app.use('/api',(req,res,next)=>apiLimit(req.ip)?next():res.status(429).json({error:'Terlalu banyak permintaan. Coba lagi nanti.'}));
app.use('/api/auth',(req,res,next)=>authLimit(req.ip)?next():res.status(429).json({error:'Terlalu banyak percobaan login. Tunggu satu menit.'}));
app.use(cors({ origin: ORIGIN }));
app.use(express.json({ limit: '80kb' }));
const http = createServer(app);
const io = new Server(http, { cors: { origin: ORIGIN }, maxHttpBufferSize: 20000 });
const online = new Map(); // userId -> Set(socket.id)
const query = async (sql, params=[]) => (await db.execute(sql, params))[0];
const cleanUser = x => ({ id:x.id, username:x.username, displayName:x.display_name });
const tokenOf = user => jwt.sign({ id:user.id },process.env.JWT_SECRET,{ expiresIn:'7d' });
const parseToken = t => jwt.verify(t, process.env.JWT_SECRET,{algorithms:['HS256']});
const auth = (req,res,next) => {
  try { req.userId = Number(parseToken((req.headers.authorization||'').replace(/^Bearer /i,''))?.id); if (!positiveId(req.userId)) throw Error(); next(); }
  catch { res.status(401).json({ error:'Silakan login kembali.' }); }
};
const wrap = fn => (req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
const membership = async (cid,uid) => {
  if(!positiveId(cid)||!positiveId(uid))return false;
  const rows = await query('SELECT 1 FROM conversation_members WHERE conversation_id=? AND user_id=?',[cid,uid]);
  return rows.length>0;
};
const conversationList = async uid => {
  const rows=await query(`SELECT c.id,c.type,c.title,c.created_at FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id=c.id
    WHERE cm.user_id=? ORDER BY c.id DESC`,[uid]);
  const result=[];
  for(const c of rows){
    const members=await query(`SELECT u.id,u.username,u.display_name FROM users u JOIN conversation_members cm ON cm.user_id=u.id WHERE cm.conversation_id=?`,[c.id]);
    result.push({...c,members:members.map(cleanUser)});
  }
  return result;
};
app.get('/api/health',(_req,res)=>res.json({ok:true}));
app.post('/api/auth/register',wrap(async(req,res)=>{
  const {username,displayName,password}=req.body||{};
  if(!credentialsValid(req.body,true)) return res.status(400).json({error:'Username 3–24 huruf/angka/_, nama 1–80 karakter, password 6 karakter hingga 72 byte.'});
  const exists=await query('SELECT id FROM users WHERE username=?',[username]);
  if(exists.length) return res.status(409).json({error:'Username sudah digunakan.'});
  const hash=await bcrypt.hash(password,11);
  const r=await query('INSERT INTO users(username,display_name,password_hash) VALUES(?,?,?)',[username,displayName.trim(),hash]);
  const user={id:r.insertId,username,displayName:displayName.trim()};
  res.status(201).json({user,token:tokenOf(user)});
}));
app.post('/api/auth/login',wrap(async(req,res)=>{
  if(!credentialsValid(req.body))return res.status(400).json({error:'Kredensial tidak valid.'});
  const rows=await query('SELECT * FROM users WHERE username=?',[req.body.username||'']);
  if(!rows.length || !await bcrypt.compare(String(req.body.password||''),rows[0].password_hash)) return res.status(401).json({error:'Username atau password salah.'});
  const user=cleanUser(rows[0]);res.json({user,token:tokenOf(user)});
}));
app.get('/api/me',auth,wrap(async(req,res)=>{
  const rows=await query('SELECT id,username,display_name FROM users WHERE id=?',[req.userId]);
  if(!rows.length)return res.status(404).json({error:'User tidak ada'});
  res.json(cleanUser(rows[0]));
}));
app.get('/api/users',auth,wrap(async(req,res)=>{
  const q=String(req.query.q||'').trim().slice(0,40);
  const rows=await query('SELECT id,username,display_name FROM users WHERE id<>? AND (username LIKE ? OR display_name LIKE ?) ORDER BY id DESC LIMIT 50',[req.userId,`%${q}%`,`%${q}%`]);
  res.json(rows.map(u=>({...cleanUser(u),online:online.has(u.id)})));
}));
app.get('/api/contacts',auth,wrap(async(req,res)=>{
  const rows=await query('SELECT u.id,u.username,u.display_name FROM contacts c JOIN users u ON u.id=c.contact_id WHERE c.owner_id=? ORDER BY u.display_name',[req.userId]);
  res.json(rows.map(u=>({...cleanUser(u),online:online.has(u.id)})));
}));
app.post('/api/contacts',auth,wrap(async(req,res)=>{
  const id=Number(req.body.userId);
  if(!positiveId(id)||id===req.userId)return res.status(400).json({error:'Peer tidak valid.'});
  const target=await query('SELECT id FROM users WHERE id=?',[id]);
  if(!target.length)return res.status(404).json({error:'Peer tidak ditemukan.'});
  await query('INSERT IGNORE INTO contacts(owner_id,contact_id) VALUES(?,?)',[req.userId,id]);
  res.json({ok:true});
}));
app.get('/api/conversations',auth,wrap(async(req,res)=>res.json(await conversationList(req.userId))));
app.post('/api/conversations/direct',auth,wrap(async(req,res)=>{
  const target=Number(req.body.userId);
  if(!positiveId(target)||target===req.userId)return res.status(400).json({error:'Peer tidak valid.'});
  const allowed=await query('SELECT id FROM users WHERE id=?',[target]);
  if(!allowed.length)return res.status(404).json({error:'Peer tidak ditemukan.'});
  const conn=await db.getConnection();let id;let locked=false;
  const lockKey='nexa:direct:'+Math.min(req.userId,target)+':'+Math.max(req.userId,target);
  try {
    const [locks]=await conn.execute('SELECT GET_LOCK(?,5) AS acquired',[lockKey]);
    locked=Number(locks[0].acquired)===1;
    if(!locked)return res.status(503).json({error:'Percakapan sedang dibuat. Coba lagi.'});
    await conn.beginTransaction();
    const [found]=await conn.execute(`SELECT c.id FROM conversations c
      JOIN conversation_members a ON a.conversation_id=c.id AND a.user_id=?
      JOIN conversation_members b ON b.conversation_id=c.id AND b.user_id=?
      WHERE c.type='direct' LIMIT 1`,[req.userId,target]);
    id=found[0]?.id;
    if(!id){
      const [r]=await conn.execute("INSERT INTO conversations(type,created_by) VALUES('direct',?)",[req.userId]);id=r.insertId;
      await conn.execute('INSERT INTO conversation_members(conversation_id,user_id) VALUES (?,?),(?,?)',[id,req.userId,id,target]);
    }
    await conn.commit();
  }catch(e){await conn.rollback();throw e;}finally{
    try{if(locked)await conn.execute('SELECT RELEASE_LOCK(?)',[lockKey]);}finally{conn.release();}
  }
  io.to(`user:${target}`).emit('conversation:new',{id});
  res.json({id});
}));
app.post('/api/conversations/group',auth,wrap(async(req,res)=>{
  if(typeof req.body.title!=='string'||!Array.isArray(req.body.memberIds)||req.body.memberIds.length>4)return res.status(400).json({error:'Nama dan daftar anggota grup tidak valid.'});
  const title=String(req.body.title||'').trim().slice(0,100);
  const ids=[...new Set([req.userId,...(Array.isArray(req.body.memberIds)?req.body.memberIds:[]).map(Number)])];
  if(!title || ids.length<3 || ids.length>5 || ids.some(x=>!positiveId(x)))return res.status(400).json({error:'Nama grup wajib, total anggota 3-5 orang.'});
  const userRows=await query(`SELECT id FROM users WHERE id IN (${ids.map(()=>'?').join(',')})`,ids);
  if(userRows.length!==ids.length)return res.status(400).json({error:'Ada anggota yang tidak ditemukan.'});
  const conn=await db.getConnection();let id;
  try{await conn.beginTransaction();
    const [r]=await conn.execute("INSERT INTO conversations(type,title,created_by) VALUES('group',?,?)",[title,req.userId]);id=r.insertId;
    for(const uid of ids)await conn.execute('INSERT INTO conversation_members(conversation_id,user_id) VALUES(?,?)',[id,uid]);
    await conn.commit();
  }catch(e){await conn.rollback();throw e;}finally{conn.release();}
  for(const member of ids) io.to(`user:${member}`).emit('conversation:new',{id});
  res.status(201).json({id});
}));
app.get('/api/conversations/:id/messages',auth,wrap(async(req,res)=>{
  const cid=Number(req.params.id);
  if(!await membership(cid,req.userId))return res.status(403).json({error:'Bukan anggota percakapan.'});
  const rows=await query('SELECT uuid,conversation_id AS conversationId,sender_id AS senderId,kind,body,reply_to AS replyTo,created_at AS createdAt FROM messages WHERE conversation_id=? ORDER BY id DESC LIMIT 100',[cid]);
  res.json(rows.reverse());
}));
app.post('/api/messages',auth,wrap(async(req,res)=>{
  if(!messageValid(req.body))return res.status(400).json({error:'Format pesan tidak valid.'});
  const {uuid,conversationId,body,kind='text',replyTo=null}=req.body;
  const cid=Number(conversationId);
  if(!await membership(cid,req.userId))return res.status(403).json({error:'Bukan anggota percakapan.'});
  if(replyTo){const reply=await query('SELECT 1 FROM messages WHERE uuid=? AND conversation_id=?',[replyTo,cid]);if(!reply.length)return res.status(400).json({error:'Referensi balasan tidak valid.'});}
  try {await query('INSERT INTO messages(uuid,conversation_id,sender_id,kind,body,reply_to) VALUES (?,?,?,?,?,?)',[uuid,cid,req.userId,kind,body,replyTo]);}
  catch(e){
    if(e.code!=='ER_DUP_ENTRY')throw e;
    const rows=await query('SELECT conversation_id,sender_id,kind,body,reply_to FROM messages WHERE uuid=?',[uuid]);
    const old=rows[0];
    if(!old||old.conversation_id!==cid||old.sender_id!==req.userId||old.kind!==kind||old.body!==body||old.reply_to!==replyTo)return res.status(409).json({error:'UUID sudah digunakan untuk pesan berbeda.'});
    return res.json({ok:true,duplicate:true});
  }
  res.status(201).json({ok:true});
}));
app.use((err,req,res,next)=>{
  if(err.type==='entity.too.large')return res.status(413).json({error:'Payload terlalu besar.'});
  if(err instanceof SyntaxError&&err.status===400)return res.status(400).json({error:'JSON tidak valid.'});
  if(err.code==='ER_DUP_ENTRY')return res.status(409).json({error:'Data sudah digunakan.'});
  console.error('API error:',err.code||err.name);res.status(500).json({error:'Kesalahan server.'});
});

io.use((socket,next)=>{
  try{const data=parseToken(socket.handshake.auth?.token);socket.userId=Number(data.id);if(!positiveId(socket.userId))throw Error();next();}
  catch{next(new Error('Unauthorized'));}
});
io.on('connection',socket=>{
  const uid=socket.userId;
  // A single signaling endpoint per user avoids cross-tab SDP/ICE mixing.
  for(const id of [...(online.get(uid)||[])]){const previous=io.sockets.sockets.get(id);previous?.emit('session:replaced');previous?.disconnect(true);}
  const signalLimit=createLimiter(240,60000);
  const expiry=setTimeout(()=>socket.disconnect(true),Math.max(0,Number(parseToken(socket.handshake.auth.token).exp)*1000-Date.now()));
  const first=!online.has(uid);
  if(!online.has(uid))online.set(uid,new Set());
  online.get(uid).add(socket.id);
  socket.join(`user:${uid}`);
  socket.emit('presence:list',[...online.keys()]);
  if(first)io.emit('presence:change',{userId:uid,online:true});
  let signalQueue=Promise.resolve();
  socket.on('signal',payload=>{
    if(!signalLimit(uid)||!signalValid(payload))return;
    signalQueue=signalQueue.then(async()=>{
    const {to,kind,data}=payload;
    try{
      const target=Number(to);
      if(!socket.connected)return;
      const allowed=await query(`SELECT 1 FROM conversation_members a JOIN conversation_members b ON a.conversation_id=b.conversation_id WHERE a.user_id=? AND b.user_id=? LIMIT 1`,[uid,target]);
      if(!allowed.length)return;
      if(socket.connected)io.to(`user:${target}`).emit('signal',{from:uid,fromSession:socket.id,kind,data});
    }catch(e){console.error('signal error',e.code||e.name);}
    }).catch(e=>console.error('signal queue error',e.name));
  });
  socket.on('disconnect',()=>{
    clearTimeout(expiry);
    const set=online.get(uid);if(!set)return;
    set.delete(socket.id);
    if(!set.size){online.delete(uid);io.emit('presence:change',{userId:uid,online:false});}
  });
});

await db.query('SELECT 1');
http.on('error',err=>{console.error('NEXA listen error:',err.code);db.end().finally(()=>{process.exitCode=1;});});
http.listen(PORT,'0.0.0.0',()=>console.log(`NEXA API + signaling active on http://localhost:${PORT}`));
