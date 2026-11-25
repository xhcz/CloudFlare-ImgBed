import { currentAccount, requireAccountAdmin } from './registration.js';

function reply(value, status = 200) {
    return Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

export async function handleClaims(context, admin = false) {
    const { request, env } = context;
    const db = env.img_d1;
    if (!db || env.img_url?.get) return reply({error: 'File claims require a D1 file index'}, 503);
    if (admin) {
        const denied = await requireAccountAdmin(context);
        if (denied) return denied;
    }
    const account = admin ? null : await currentAccount(context);
    if (!admin && !account) return reply({error: '请先登录'}, 401);
    const url = new URL(request.url);
    const offset = Math.max(0, Number.parseInt(url.searchParams.get('offset'), 10) || 0);
    if (request.method === 'GET') {
        if (!admin && url.searchParams.get('files') === '1') {
            const rows = await db.prepare("SELECT id FROM files WHERE json_extract(metadata,'$.OwnerAccountId')=? ORDER BY timestamp DESC,id LIMIT 100 OFFSET ?").bind(account.id,offset).all();
            return reply({files: rows.results});
        }
        const query = admin
            ? db.prepare("SELECT * FROM file_claims WHERE status='pending' ORDER BY created_at,id LIMIT 100 OFFSET ?").bind(offset)
            : db.prepare('SELECT * FROM file_claims WHERE account_id=? ORDER BY created_at DESC,id LIMIT 100 OFFSET ?').bind(account.id,offset);
        return reply({claims:(await query.all()).results});
    }
    if (request.method !== 'POST') return reply({error:'Method not allowed'},405);
    if (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) return reply({error:'Origin mismatch'},403);
    if (!request.headers.get('Content-Type')?.startsWith('application/json')) return reply({error:'Expected JSON'},415);
    const body = await request.json().catch(() => null);
    if (!body) return reply({error:'Invalid JSON'},400);
    if (!admin) {
        const {fileId,evidence} = body;
        if (typeof fileId !== 'string' || !fileId || fileId.length > 2048 || typeof evidence !== 'string' || !evidence.trim() || evidence.length > 2000) return reply({error:'请填写文件 ID 和可供管理员核验的上传凭据'},400);
        const id = crypto.randomUUID();
        const result = await db.prepare(`INSERT OR IGNORE INTO file_claims(id,file_id,file_timestamp,account_id,evidence,created_at)
            SELECT ?,id,timestamp,?,?,? FROM files WHERE id=? AND channel IS NOT NULL AND channel<>'' AND file_name IS NOT NULL AND json_extract(metadata,'$.OwnerAccountId') IS NULL`)
            .bind(id,account.id,evidence.trim(),Date.now(),fileId).run();
        return result.meta.changes ? reply({id,status:'pending'},201) : reply({error:'文件不可认领或已有待审核申请'},409);
    }
    const {id,decision} = body;
    if (typeof id !== 'string' || !['approve','reject'].includes(decision)) return reply({error:'Invalid decision'},400);
    const status = decision === 'approve' ? 'approved' : 'rejected';
    const check = decision === 'approve' ? " AND EXISTS(SELECT 1 FROM files WHERE id=file_claims.file_id AND timestamp IS file_claims.file_timestamp AND json_extract(metadata,'$.OwnerAccountId') IS NULL)" : '';
    const review = db.prepare("UPDATE file_claims SET status=? WHERE id=? AND status='pending'" + check).bind(status,id);
    const result = await review.run();
    return result.meta.changes ? reply({id,status}) : reply({error:'申请或文件状态已变化'},409);
}
