import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { loadFunction } from '../helpers/loadFunction.js';

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(new URL('../../database/migrations/registration_bots.sql', import.meta.url), 'utf8'));
const id = 'a'.repeat(32);
const code = 'd'.repeat(32);
db.prepare('INSERT INTO registration_bots(id,platform,account_id,url,callback_url,secret,enabled) VALUES(?,?,?,?,?,?,1)')
    .run(id,'telegram','10','','','secret');
const d1 = {
    prepare(sql) {
        let args = [];
        const statement = db.prepare(sql);
        return {
            bind(...values) { args = values; return this; },
            first() { return statement.get(...args); },
            run() { return {meta:statement.run(...args)}; }
        };
    },
    batch(statements) { return statements.map(statement => statement.run()); }
};
const messages = [];
let verified = 0;
const bot = {id, platform:'telegram'};
const {onRequest, signedDiscordRequest} = await loadFunction('functions/api/verification/callback.js',{
    configuredBots:async () => new Map([[id,bot]]),
    digest:async s => s,
    json:(v,status=200) => Response.json(v,{status}),
    telegram:async (b,method,data) => messages.push({method,data}),
    isVerificationPending:async () => true,
    verifyRegistration:async () => {verified++;return true;}
});
async function post(update,secret='secret') {
    return onRequest({env:{img_d1:d1},request:new Request('https://example.org/api/verification/callback?id='+id,{
        method:'POST',headers:{'x-telegram-bot-api-secret-token':secret},body:JSON.stringify(update)
    })});
}
const from={id:123};
const message={from,chat:{id:123,type:'private'},text:'/start '+code};
assert.equal((await post({message},'wrong')).status,401);
assert.equal(messages.length,0);
assert.equal((await post({message})).status,200);
const [{data:{text,reply_markup}}]=messages;
const [,left,right]=/请选择 (\d+) \+ (\d+)/.exec(text);
const button=reply_markup.inline_keyboard[0].find(b=>Number(b.text)===Number(left)+Number(right));
const callback_query={id:'cb',message,from,data:button.callback_data};
await post({callback_query:{...callback_query,from:{id:124}}});
assert.equal(verified,0);
await post({callback_query});
await post({callback_query});
assert.equal(verified,1);

const pair=await crypto.subtle.generateKey('Ed25519',true,['sign','verify']);
const hex=buf=>Buffer.from(buf).toString('hex');
const key=hex(await crypto.subtle.exportKey('raw',pair.publicKey));
const timestamp=String(Math.floor(Date.now()/1000));
const body='{"type":1}';
const sig=hex(await crypto.subtle.sign('Ed25519',pair.privateKey,new TextEncoder().encode(timestamp+body)));
const headers=new Headers({'x-signature-timestamp':timestamp,'x-signature-ed25519':sig});
assert.ok(await signedDiscordRequest(headers,body,key));
assert.equal(await signedDiscordRequest(headers,body+' ',key),false);
headers.set('x-signature-timestamp','1000000000');
assert.equal(await signedDiscordRequest(headers,body,key),false);
console.log('Bot verification secret, identity, replay and Discord signature checks passed.');
