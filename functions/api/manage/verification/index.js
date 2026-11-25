import { configuredBots, listBots, json, telegram, discord } from '../../../utils/verificationBots.js';
import { requireAccountAdmin } from '../../../utils/registration.js';

export async function onRequest(context) {
    const denied = await requireAccountAdmin(context);
    if (denied) return denied;
    const {request,env} = context;
    if (request.method === 'GET') return json({bots:await listBots(context,true)});
    if (request.method !== 'POST') return json({error:'Method not allowed'},405);
    const body = await request.json().catch(() => null);
    if (!body || typeof body.enabled !== 'boolean') return json({error:'无效设置'},400);
    const bot = (await configuredBots(context)).get(body.id);
    if (!bot || bot.platform !== body.platform) return json({error:'渠道不可用'},404);
    const db = env.img_d1;
    const callback = new URL('/api/verification/callback?id=' + bot.id,request.url).href;
    const previous = await db.prepare('SELECT * FROM registration_bots WHERE id=?').bind(bot.id).first();
    try {
        if (!body.enabled) {
            if (!previous) return json({enabled:false});
            await db.prepare('UPDATE registration_bots SET enabled=0 WHERE id=?').bind(bot.id).run();
            if (bot.platform === 'telegram') {
                if ((await telegram(bot,'getWebhookInfo')).url === previous.callback_url) await telegram(bot,'deleteWebhook');
            } else {
                const app = await discord(bot,'/applications/@me');
                if (app.interactions_endpoint_url === previous.callback_url) await discord(bot,'/applications/@me','PATCH',{interactions_endpoint_url:''});
            }
            return json({enabled:false});
        }
        let secret, accountId, url, endpoint;
        if (bot.platform === 'telegram') {
            const [me,info] = await Promise.all([telegram(bot,'getMe'),telegram(bot,'getWebhookInfo')]);
            accountId = String(me.id);
            url = 'https://t.me/' + me.username;
            endpoint = info.url;
            secret = previous?.secret || crypto.randomUUID();
        } else {
            const app = await discord(bot,'/applications/@me');
            accountId = app.id;
            secret = app.verify_key;
            if (!/^[a-f0-9]{64}$/i.test(secret)) return json({error:'Discord 验签公钥无效'},400);
            url = 'https://discord.com/users/' + app.id;
            endpoint = app.interactions_endpoint_url;
        }
        if (endpoint && endpoint !== callback) return json({error:'该 Bot 已绑定其他回调地址。请改用其他 Bot 或先迁移原有回调。'},409);
        // Save credentials first so Discord can issue its signed PING during activation.
        await db.prepare('INSERT INTO registration_bots(id,platform,account_id,url,callback_url,secret) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET account_id=excluded.account_id,url=excluded.url,callback_url=excluded.callback_url,secret=excluded.secret')
            .bind(bot.id,bot.platform,accountId,url,callback,secret).run();
        if (bot.platform === 'telegram') {
            await telegram(bot,'setWebhook',{url:callback,secret_token:secret,allowed_updates:['message','callback_query']});
        } else {
            const commandsPath = '/applications/' + accountId + '/commands';
            const commands = await discord(bot,commandsPath);
            const existing = commands.find(c => c.name === 'verify');
            if (existing && existing.id !== previous?.command_id) return json({error:'该 Bot 的 /verify 命令已被占用'},409);
            if (!existing) {
                const command = await discord(bot,commandsPath,'POST',{name:'verify',description:'验证图床注册申请',options:[{type:3,name:'code',description:'图床页面显示的申请码',required:true}]});
                await db.prepare('UPDATE registration_bots SET command_id=? WHERE id=?').bind(command.id,bot.id).run();
            }
            if (endpoint !== callback) await discord(bot,'/applications/@me','PATCH',{interactions_endpoint_url:callback});
        }
        await db.prepare('UPDATE registration_bots SET enabled=1 WHERE id=?').bind(bot.id).run();
        return json({enabled:true,url});
    } catch {
        return json({error:'平台设置未完成，请检查 Bot 凭据及回调地址后重试。'},502);
    }
}
