import 'dotenv/config';
import mysql from 'mysql2/promise';
import {test} from 'node:test';
import assert from 'node:assert/strict';
test('live MySQL schema: foreign keys, history index and audit persistence',async()=>{
  const db=await mysql.createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD||'',database:process.env.DB_NAME||'nexa_p2p'});
  try{
    const [fks]=await db.execute('SELECT TABLE_NAME,CONSTRAINT_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE()');
    assert.ok(fks.length>=7);
    const [index]=await db.execute("SHOW INDEX FROM messages WHERE Key_name='idx_conversation_messages'");assert.equal(index.length,2);
    const [duplicates]=await db.execute('SELECT uuid FROM messages GROUP BY uuid HAVING COUNT(*)>1');assert.equal(duplicates.length,0);
    const [rows]=await db.execute("SELECT COUNT(*) AS total FROM messages m JOIN users u ON u.id=m.sender_id WHERE u.username LIKE 'audit_%'");assert.ok(rows[0].total>0);
    const [orphans]=await db.execute('SELECT m.id FROM messages m LEFT JOIN conversation_members cm ON cm.conversation_id=m.conversation_id AND cm.user_id=m.sender_id WHERE cm.user_id IS NULL LIMIT 1');assert.equal(orphans.length,0);
  }finally{await db.end();}
});
