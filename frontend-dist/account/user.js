import {api,el,list,node,run,states} from './shared.js';
const fields = form => Object.fromEntries(new FormData(form));
let bots = [];
let clock;

async function progress() {
    const data = await api('accounts/status').catch(error => {
        if ([401,403,404].includes(error.status)) return {};
        throw error;
    });
    const status = data.status;
    el('application').hidden = !status;
    el('state').textContent = states[status] || '';
    const box = el('verification');
    box.replaceChildren();
    if (status !== 'unverified') sessionStorage.removeItem('registration-code');
    const code = sessionStorage.getItem('registration-code');
    if (status === 'unverified' && code) {
        box.append(node('p','选择一个验证 Bot，在 Bot 中完成验证。'));
        for (const bot of bots) {
            const target = new URL(bot.url);
            if (target.protocol !== 'https:') continue;
            const link = node('a', bot.name || bot.platform);
            if (bot.platform === 'telegram') target.searchParams.set('start',code);
            link.href = target.href; link.target = '_blank'; link.rel = 'noopener noreferrer';
            const line = node('p',''); line.append(link);
            if (bot.platform === 'discord') line.append('　运行 ',node('code','/verify code:'+code));
            box.append(line);
        }
    }
    clearTimeout(clock);
    if (status === 'pending' || status === 'unverified') clock = setTimeout(run(progress),15000);
}

async function refresh() {
    const {user} = await api('accounts/me');
    el('guest').hidden = !!user; el('member').hidden = !user;
    if (user) {
        el('application').hidden = true;
        el('identity').textContent = user.username;
        const [owned, history] = await Promise.all([api('claims?files=1'),api('claims')]);
        list('files',owned.files,file => { const li=node('li','');const link=node('a',file.id);link.href='/file/'+file.id.split('/').map(encodeURIComponent).join('/');li.append(link);return li; },'暂无文件');
        list('claims',history.claims,c => node('li',c.file_id+' · '+(states[c.status]||c.status)),'暂无认领申请');
    } else {
        bots = (await api('verification')).bots;
        el('availability').textContent = bots.length ? '提交后，请前往 Telegram 或 Discord 验证。' : '暂未开放注册验证。';
        el('register').querySelector('button').disabled = !bots.length;
        await progress();
    }
}
el('login').onsubmit = run(async e => { await api('accounts/login',fields(e.target)); e.target.reset(); await refresh(); });
el('register').onsubmit = run(async e => {
    const data=await api('accounts/register',fields(e.target));
    sessionStorage.setItem('registration-code',data.verificationCode); e.target.reset(); await progress();
});
el('refresh').onclick = run(progress);
el('logout').onclick = run(async () => { await api('accounts/logout',{}); await refresh(); });
el('claim').onsubmit = run(async e => { await api('claims',fields(e.target)); e.target.reset(); await refresh(); });
run(refresh)();
