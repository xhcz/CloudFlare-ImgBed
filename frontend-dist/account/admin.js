import {api,el,list,node,run,states} from './shared.js';

function button(title,action) {
    const item = node('button',title);
    item.onclick = run(async () => { await action(); await refresh(); });
    return item;
}
function review(path,row,title,details) {
    const card = node('article','');
    card.append(node('strong',title),node('p',details));
    if (row.status === 'pending') {
        for (const [decision,label] of [['approve','通过'],['reject','拒绝']]) {
            card.append(button(label,() => api('manage/'+path,{id:row.id,decision})));
        }
    }
    return card;
}
async function refresh() {
    const [providers,applications,claims] = await Promise.all(['verification','accounts','claims'].map(name => api('manage/'+name)));
    list('bots',providers.bots,bot => {
        const card=node('article','');
        card.append(node('strong',bot.name || bot.platform),node('p',bot.platform+' · '+(bot.enabled?'验证已开启':'验证已关闭')),
            button(bot.enabled?'关闭注册验证':'启用注册验证',() => api('manage/verification',{platform:bot.platform,id:bot.id,enabled:!bot.enabled})));
        return card;
    },'未配置可用于验证的渠道');
    list('accounts',applications.accounts,a => review('accounts',a,a.username,[states[a.status],a.platform,a.platform_user_id,new Date(a.created_at).toLocaleString()].filter(Boolean).join(' · ')),'暂无注册申请');
    list('claims',claims.claims,c => review('claims',c,c.file_id,'申请账号 '+c.account_id+' · '+c.evidence),'暂无待审认领');
}
el('refresh').onclick=run(refresh);
run(refresh)();
