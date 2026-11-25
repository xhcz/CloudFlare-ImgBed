// Use the same channel labels as files.channel. Both levels receive equal target shares.
const labels = { telegram: 'TelegramNew', discord: 'Discord', huggingface: 'HuggingFace',
    cfr2: 'CloudflareR2', s3: 'S3', webdav: 'WebDAV' };
const chunkedTypes = new Set(['telegram', 'discord', 's3', 'cfr2']);

export function routeCandidates(context, bytes, chunked) {
    const choices = [];
    for (const [type, label] of Object.entries(labels)) {
        if (chunked && !chunkedTypes.has(type)) continue;
        if (type === 'cfr2' && !context.env.img_r2) continue;
        const settings = context.uploadConfig[type];
        const instances = settings?.channels || [];
        const eligible = settings?.loadBalance?.enabled ? instances : instances.slice(0, 1);
        for (const instance of eligible) {
            const limit = (instance.isNitro ? 25 : 10) * 1048576;
            if (!chunked && type === 'discord' && bytes > limit) continue;
            choices.push({ type, label, name: instance.name });
        }
    }
    return choices;
}

// Selection and reservation share one SQLite write statement, including under concurrency.
export const reserveSql = `
WITH params(choices,now,size,id,expiry) AS (VALUES (?,?,?,?,?)), candidates AS (
    SELECT json_extract(value,'$.label') channel,json_extract(value,'$.name') name FROM params,json_each(choices)
), usage AS (
    SELECT channel,name,files,bytes FROM route_usage
    UNION ALL SELECT channel,name,1,bytes FROM route_reservations WHERE expires>(SELECT now FROM params)
), types AS (
    SELECT c.channel,coalesce(sum(u.files),0) files,coalesce(sum(u.bytes),0) bytes
    FROM (SELECT DISTINCT channel FROM candidates) c LEFT JOIN usage u USING(channel) GROUP BY c.channel
), instances AS (
    SELECT c.channel,c.name,coalesce(sum(u.files),0) files,coalesce(sum(u.bytes),0) bytes
    FROM candidates c LEFT JOIN usage u USING(channel,name) GROUP BY c.channel,c.name
), scores AS (
    SELECT channel,name,
        max((files+1.0)/(1+sum(files) OVER(PARTITION BY channel)),
            (bytes+(SELECT size FROM params))*1.0/max(1,(SELECT size FROM params)+sum(bytes) OVER(PARTITION BY channel))) instance_score
    FROM instances
), type_scores AS (
    SELECT channel,max((files+1.0)/(1+sum(files) OVER()),
        (bytes+(SELECT size FROM params))*1.0/max(1,(SELECT size FROM params)+sum(bytes) OVER())) type_score FROM types
)
INSERT INTO route_reservations SELECT (SELECT id FROM params),channel,name,(SELECT size FROM params),(SELECT expiry FROM params) FROM scores JOIN type_scores USING(channel)
ORDER BY type_score,instance_score,random() LIMIT 1 RETURNING channel,name`;

export async function reserveRoute(context, candidates, bytes, id) {
    const db = context.env.img_d1;
    if (!db || context.env.img_url?.get) throw new Error('Automatic upload routing requires D1 as the file index');
    const now = Date.now();
    await db.prepare('DELETE FROM route_reservations WHERE expires<=?').bind(now).run();
    const selected = await db.prepare(reserveSql)
        .bind(JSON.stringify(candidates), now, bytes, id, now + 3600000).first();
    return candidates.find(c => c.label === selected?.channel && c.name === selected?.name);
}

export async function releaseRoute(env, id) {
    await env.img_d1.prepare('DELETE FROM route_reservations WHERE id=?').bind(id).run();
}
