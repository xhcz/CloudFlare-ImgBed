import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { reserveSql, routeCandidates } from '../../functions/utils/uploadRouting.js';

const migration = readFileSync(new URL('../../database/migrations/upload_routing.sql', import.meta.url), 'utf8');
for (const recursive of [0, 1]) {
    const db = new DatabaseSync(':memory:');
    db.exec(`PRAGMA recursive_triggers=${recursive}`);
    db.exec('CREATE TABLE files(id TEXT PRIMARY KEY,channel TEXT,channel_name TEXT,file_size TEXT,metadata TEXT)');
    const put = db.prepare('INSERT OR REPLACE INTO files VALUES(?,?,?,?,?)');
    put.run('old', 'Discord', 'dc', '0.5', '{}');
    db.exec(migration);
    db.exec(migration);
    const usage = db.prepare('SELECT files,bytes FROM route_usage WHERE channel=?');
    assert.equal(usage.get('Discord').bytes, 524288);
    put.run('old', 'Discord', 'dc', '0', '{"FileSizeBytes":37}');
    assert.equal(usage.get('Discord').files, 1);
    assert.equal(usage.get('Discord').bytes, 37);
    db.exec("UPDATE files SET channel='TelegramNew',channel_name='tg1' WHERE id='old'");
    assert.equal(usage.get('Discord').files, 0);
    db.exec("DELETE FROM files WHERE id='old'");
    assert.equal(usage.get('TelegramNew').files, 0);

    const config = { telegram: { channels: [{name:'tg1'},{name:'tg2'}], loadBalance:{enabled:true} },
        discord: { channels: [{name:'dc'}] } };
    const candidates = routeCandidates({env:{}, uploadConfig: config}, 100, false);
    const reserve = db.prepare(reserveSql);
    for (let n=0; n<32; n++) reserve.get(JSON.stringify(candidates), 5, 100, String(n), 50);
    const counts = db.prepare('SELECT name,count(*) n FROM route_reservations GROUP BY name').all();
    assert.deepEqual(Object.fromEntries(counts.map(row => [row.name,row.n])), {dc:16,tg1:8,tg2:8});
    db.exec('DELETE FROM route_reservations');
    put.run('big', 'Discord', 'dc', '1', '{"FileSizeBytes":1000000}');
    assert.equal(reserve.get(JSON.stringify(candidates), 5, 100, 'next', 50).channel, 'TelegramNew');
    db.close();
}
console.log('Upload routing counters, concurrent reservations, backfill and size checks passed.');
