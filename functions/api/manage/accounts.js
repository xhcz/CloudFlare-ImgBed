import { json, requireAccountAdmin } from '../../utils/registration.js';

export async function onRequest(context) {
    const error = await requireAccountAdmin(context);
    if (error) return error;
    const db = context.env.img_d1;
    if (context.request.method === 'GET') {
        const { results } = await db.prepare(`SELECT id,username,status,platform,platform_user_id,created_at FROM imgbed_accounts
            WHERE status!='unverified' OR verification_expires>? ORDER BY (status='pending') DESC,created_at DESC`).bind(Date.now()).all();
        return json({accounts:results});
    }
    if (context.request.method !== 'POST') return json({error:'请求方式无效'},405);
    const body = await context.request.json().catch(() => null);
    if (typeof body?.id !== 'string' || !['approve','reject'].includes(body.decision)) return json({error:'审核操作无效'},400);
    const status = body.decision === 'approve' ? 'approved' : 'rejected';
    const result = await db.prepare("UPDATE imgbed_accounts SET status=? WHERE id=? AND status='pending' AND platform_user_id IS NOT NULL")
        .bind(status,body.id).run();
    return result.meta.changes ? json({status}) : json({error:'该申请当前不可审核'},409);
}
