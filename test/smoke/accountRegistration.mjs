import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { SqliteD1 } from '../../deploy/server/sqliteD1.js';
import { onRequest as accounts } from '../../functions/api/accounts/[[path]].js';
import { onRequest as reviews } from '../../functions/api/manage/accounts.js';
import { createSession } from '../../functions/utils/auth/sessionManager.js';
import { digest, verifyRegistration } from '../../functions/utils/registration.js';

const db = new SqliteD1(':memory:');
try {
    const env = { img_d1: db, TG_BOT_TOKEN:'test-token', TG_CHAT_ID:'1', BASIC_USER:'reviewer', BASIC_PASS:'admin-test-password' };
    db.exec(readFileSync(new URL('../../database/init.sql',import.meta.url),'utf8'));
    await db.prepare("INSERT INTO registration_bots VALUES(?, 'telegram', '1', '', '', '', NULL, 1)")
        .bind((await digest('telegram:test-token')).slice(0,32)).run();
    function context(action,body,cookie='') {
        return {env,request:new Request('https://test.invalid/api/accounts/'+action,{method:body?'POST':'GET',
            headers:{'Cookie':cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined})};
    }
    const input = {username:'测试用户',password:'sample-test-password'};
    const signup = await accounts(context('register',input));
    assert.equal(signup.status,201,await signup.clone().text());
    const {applicationId,verificationCode} = await signup.json();
    const receipt = signup.headers.get('set-cookie').split(';')[0];
    assert.equal((await accounts(context('login',input))).status,403);
    assert.equal(await verifyRegistration(env,verificationCode,'telegram','1234'),true);
    assert.equal(await verifyRegistration(env,verificationCode,'telegram','1234'),false);
    assert.equal((await (await accounts(context('status',null,receipt))).json()).status,'pending');
    const decision = {id:applicationId,decision:'approve'};
    assert.equal((await reviews(context('manage',decision))).status,403);
    const {cookie} = await createSession(env,'admin','reviewer');
    assert.equal((await reviews(context('manage',decision,cookie))).status,200);
    assert.equal((await reviews(context('manage',decision,cookie))).status,409);
    const login = await accounts(context('login',input));
    assert.equal(login.status,200);
    const session = login.headers.get('set-cookie').split(';')[0];
    assert.equal((await (await accounts(context('me',null,session))).json()).user.id,applicationId);
    await accounts(context('logout',{},session));
    assert.equal((await (await accounts(context('me',null,session))).json()).user,null);
    console.log('Account registration, binding, approval and session smoke passed.');
} finally {
    db.db.close();
}
