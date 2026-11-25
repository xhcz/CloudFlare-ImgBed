import { fetchUploadConfig } from './sysConfig.js';

import { digest } from './registration.js';
export { json, digest } from './registration.js';

export async function configuredBots(context) {
    const config = await fetchUploadConfig(context.env);
    const bots = new Map();
    for (const platform of ['telegram','discord']) {
        for (const channel of config[platform]?.channels || []) {
            if (!channel.botToken || channel.enabled === false) continue;
            const id = (await digest(platform + ':' + channel.botToken)).slice(0,32);
            if (!bots.has(id)) bots.set(id, {id,platform,name:channel.name,token:channel.botToken});
        }
    }
    return bots;
}

export async function listBots(context, admin) {
    if (!context.env.img_d1) return [];
    const bots = await configuredBots(context);
    const rows = await context.env.img_d1.prepare('SELECT id,url,enabled,callback_url FROM registration_bots').all();
    const saved = new Map(rows.results.map(row => [row.id,row]));
    return Array.from(bots.values()).filter(bot => admin || saved.get(bot.id)?.enabled).map(({id,name,platform}) => {
        const row = saved.get(id);
        return {id,name,platform,enabled:!!row?.enabled,url:row?.url || '',...(admin && row ? {callbackUrl:row.callback_url} : {})};
    });
}

export async function telegram(bot, method, data = {}) {
    const response = await fetch('https://api.telegram.org/bot' + bot.token + '/' + method, {
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(data)
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error('Telegram 未能完成 ' + method);
    return result.result;
}

export async function discord(bot,path,method='GET',data) {
    const response = await fetch('https://discord.com/api/v10' + path,{
        method,headers:{Authorization:'Bot ' + bot.token,'Content-Type':'application/json'},
        body:data === undefined ? undefined : JSON.stringify(data)
    });
    if (!response.ok) throw new Error('Discord 请求失败 (' + response.status + ')');
    return response.status === 204 ? null : response.json();
}
