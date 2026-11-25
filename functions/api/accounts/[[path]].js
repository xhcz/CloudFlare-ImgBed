import { hashPassword, verifyPassword } from '../../utils/auth/passwordHash.js';
import { listBots } from '../../utils/verificationBots.js';
import { accountCookie, allowRequest, applicationCookie, cookie, cookieToken, currentAccount, digest, json, randomToken } from '../../utils/registration.js';

const day = 86400;

async function credentials(request) {
    const body = await request.json().catch(() => null);
    if (typeof body?.username !== 'string' || typeof body.password !== 'string') return null;
    const username = body.username.normalize('NFKC').trim().toLowerCase();
    if (!/^[\p{L}\p{N}_.-]{2,64}$/u.test(username) || body.password.length < 8 || body.password.length > 256) return null;
    return { username, password: body.password };
}

async function rateLimited(context, action) {
    const db = context.env.img_d1;
    const ip = context.request.headers.get('CF-Connecting-IP') || 'local';
    const window = 15 * 60 * 1000;
    const now = Date.now();
    const key = await digest(action + ':' + ip + ':' + Math.floor(now / window));
    const [,result] = await db.batch([
        db.prepare('DELETE FROM imgbed_account_limits WHERE expires<=?').bind(now),
        db.prepare(`INSERT INTO imgbed_account_limits(key,attempts,expires) VALUES(?,1,?)
            ON CONFLICT(key) DO UPDATE SET attempts=attempts+1 RETURNING attempts`).bind(key, now + window),
    ]);
    return result.results[0].attempts > (action === 'register' ? 12 : 30);
}

async function register(context, input) {
    if (!(await listBots(context, false)).length) return json({error:'管理员尚未启用注册验证 Bot'}, 503);
    const db = context.env.img_d1;
    const verificationCode = randomToken();
    const applicationToken = randomToken();
    const applicationId = crypto.randomUUID();
    const now = Date.now();
    const [,result] = await db.batch([
        db.prepare("DELETE FROM imgbed_accounts WHERE username=? AND status='unverified' AND verification_expires<=?").bind(input.username, now),
        db.prepare(`INSERT INTO imgbed_accounts(id,username,password_hash,status,created_at,verification_hash,verification_expires,application_hash)
            VALUES(?,?,?,'unverified',?,?,?,?) ON CONFLICT(username) DO NOTHING`)
            .bind(applicationId, input.username, await hashPassword(input.password), now, await digest(verificationCode),
                now + 15 * 60 * 1000, await digest(applicationToken)),
    ]);
    if (!result.meta.changes) return json({error:'用户名已被使用'},409);
    return json({applicationId,verificationCode,status:'unverified'},201,{
        'Set-Cookie': cookie(applicationCookie,applicationToken,30*day),
    });
}

async function login(context, input) {
    const db = context.env.img_d1;
    const user = await db.prepare('SELECT id,username,password_hash,status FROM imgbed_accounts WHERE username=?').bind(input.username).first();
    if (!user || !await verifyPassword(input.password,user.password_hash)) return json({error:'用户名或密码不正确'},401);
    if (user.status !== 'approved') return json({error:'账号尚未获准登录',status:user.status},403);
    const token = randomToken();
    const now = Date.now();
    await db.batch([
        db.prepare('DELETE FROM imgbed_account_sessions WHERE expires<=?').bind(now),
        db.prepare('INSERT INTO imgbed_account_sessions(token_hash,account_id,expires) VALUES(?,?,?)')
            .bind(await digest(token), user.id, now + 7*day*1000),
    ]);
    return json({user:{id:user.id,username:user.username}},200,{'Set-Cookie':cookie(accountCookie,token,7*day)});
}

export async function onRequest(context) {
    const error = allowRequest(context);
    if (error) return error;
    const action = new URL(context.request.url).pathname.split('/').filter(Boolean).pop();
    const { request,env } = context;
    if (request.method === 'GET' && action === 'me') return json({user:await currentAccount(context)});
    if (request.method === 'GET' && action === 'status') {
        const token = cookieToken(request,applicationCookie);
        const row = token && await env.img_d1.prepare('SELECT status,verification_expires FROM imgbed_accounts WHERE application_hash=?')
            .bind(await digest(token)).first();
        if (!row) return json({error:'找不到申请'},404);
        return json({status:row.status === 'unverified' && row.verification_expires <= Date.now() ? 'expired' : row.status});
    }
    if (request.method === 'POST' && action === 'logout') {
        const token = cookieToken(request,accountCookie);
        if (token) await env.img_d1.prepare('DELETE FROM imgbed_account_sessions WHERE token_hash=?').bind(await digest(token)).run();
        return json({ok:true},200,{'Set-Cookie':cookie(accountCookie,'',0)});
    }
    if (request.method === 'POST' && ['register','login'].includes(action)) {
        if (await rateLimited(context, action)) return json({error:'尝试过于频繁，请稍后再试'},429);
        const input = await credentials(request);
        if (!input) return json({error:'用户名须为 2–64 个字母、数字、点、横线或下划线，密码须为 8–256 个字符'},400);
        return action === 'register' ? register(context,input) : login(context,input);
    }
    return json({error:'未知操作'},404);
}
