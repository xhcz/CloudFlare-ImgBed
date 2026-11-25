import {configuredBots,digest,json,telegram} from '../../utils/verificationBots.js';
import {isVerificationPending,verifyRegistration} from '../../utils/registration.js';

function bytes(hex) {
    return Uint8Array.from(hex.match(/../g), pair => parseInt(pair,16));
}

export async function signedDiscordRequest(headers,body,key) {
    const timestamp = headers.get('x-signature-timestamp') || '';
    const signature = headers.get('x-signature-ed25519') || '';
    if (!/^\d{10}$/.test(timestamp) || Math.abs(Date.now()/1000-Number(timestamp)) > 300 ||
        !/^[a-f0-9]{128}$/i.test(signature) || !/^[a-f0-9]{64}$/i.test(key)) return false;
    const publicKey = await crypto.subtle.importKey('raw',bytes(key),'Ed25519',false,['verify']);
    return crypto.subtle.verify('Ed25519',publicKey,bytes(signature),new TextEncoder().encode(timestamp+body));
}

const randomInt = max => crypto.getRandomValues(new Uint32Array(1))[0] % max;
const invalidCode = {text:'申请码无效或已过期，请返回图床重新申请验证。'};

async function issue(context,bot,user,code) {
    if (!/^[a-f0-9]{32}$/.test(code) || !await isVerificationPending(context.env,code)) return invalidCode;
    const db = context.env.img_d1;
    const now = Date.now();
    const nonce = crypto.randomUUID().replaceAll('-','').slice(0,16);
    const answer = randomInt(16)+3;
    const left = randomInt(answer-1)+1;
    const options = [answer-1,answer,answer+1];
    const rotation = randomInt(3);
    const hash = await digest(code);
    const [,inserted] = await db.batch([
        db.prepare('DELETE FROM registration_challenges WHERE expires<=?').bind(now),
        db.prepare('INSERT OR IGNORE INTO registration_challenges(code_hash,nonce,bot_id,platform_user,answer,expires) VALUES(?,?,?,?,?,?)')
            .bind(hash,nonce,bot.id,user,answer,now+300000)
    ]);
    if (!inserted.meta.changes) return {text:'该申请已有验证题，请使用原题，或在五分钟后重试。'};
    return {text:'请选择 '+left+' + '+(answer-left)+' 的结果，确认本人的图床注册申请。',buttons:options.map((_,i)=>{
        const n = options[(i+rotation)%3];
        return {label:String(n),data:[code,nonce,n].join('.')};
    })};
}

async function answer(context,bot,user,payload) {
    const match = /^([0-9a-f]{32})\.([0-9a-f]{16})\.(\d{1,2})$/.exec(payload);
    if (!match) return invalidCode;
    const [ ,code,nonce,selected] = match;
    const row = await context.env.img_d1.prepare('UPDATE registration_challenges SET nonce=? WHERE nonce=? AND code_hash=? AND bot_id=? AND platform_user=? AND expires>? RETURNING answer')
        .bind(crypto.randomUUID(),nonce,await digest(code),bot.id,user,Date.now()).first();
    if (!row) return {text:'验证题已失效，请返回图床查看申请状态。'};
    if (row.answer !== Number(selected)) return {text:'答案错误。请在五分钟后重新领取验证题。'};
    const success = await verifyRegistration(context.env,code,bot.platform,user);
    return {text:success?'绑定成功，注册申请已提交管理员审核。':'申请已失效，或此平台账号已经绑定。'};
}

export async function onRequest(context) {
    const {env,request} = context;
    if (request.method !== 'POST') return json({},405);
    const id = new URL(request.url).searchParams.get('id');
    if (!env.img_d1 || !/^[a-f0-9]{32}$/.test(id)) return json({},404);
    const row = await env.img_d1.prepare('SELECT * FROM registration_bots WHERE id=?').bind(id).first();
    if (!row) return json({},404);
    const raw = await request.text();
    if (row.platform === 'discord') {
        if (!await signedDiscordRequest(request.headers,raw,row.secret)) return json({},401);
    } else if (request.headers.get('x-telegram-bot-api-secret-token') !== row.secret) return json({},401);
    const update = JSON.parse(raw);
    if (row.platform === 'discord' && update.application_id !== row.account_id) return json({},401);
    if (row.platform === 'discord' && update.type === 1) return json({type:1});
    if (!row.enabled) return json({},404);
    const bot = (await configuredBots(context)).get(row.id);
    if (!bot) return json({},404);
    if (bot.platform === 'discord') {
        const user = update.member?.user || update.user;
        if (!user?.id || user.bot) return json({},400);
        let result;
        if (update.type === 2 && update.data.id === row.command_id) result = await issue(context,bot,user.id,update.data.options?.find(o => o.name === 'code')?.value || '');
        else if (update.type === 3) result = await answer(context,bot,user.id,update.data.custom_id);
        else return json({},400);
        return json({type:4,data:{flags:64,content:result.text,components:result.buttons ? [{type:1,components:result.buttons.map(b=>({type:2,style:2,label:b.label,custom_id:b.data}))}]:[]}});
    }
    const query = update.callback_query;
    const message = query?.message || update.message;
    const from = query?.from || message?.from;
    if (!from?.id || from.is_bot || message?.chat.type !== 'private' || from.id !== message.chat.id) return json({ok:true});
    const user = String(from.id);
    if (query) {
        const result = await answer(context,bot,user,query.data);
        await telegram(bot,'answerCallbackQuery',{callback_query_id:query.id,text:result.text,show_alert:true});
    } else {
        const match = /^\/start\s+([a-f0-9]{32})$/.exec(message.text || '');
        if (!match) return json({ok:true});
        const result = await issue(context,bot,user,match[1]);
        await telegram(bot,'sendMessage',{chat_id:user,text:result.text,...(result.buttons ? {reply_markup:{inline_keyboard:[result.buttons.map(b=>({text:b.label,callback_data:b.data}))]}} : {})});
    }
    return json({ok:true});
}
