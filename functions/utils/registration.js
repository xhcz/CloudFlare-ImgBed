import { validateApiToken } from './auth/tokenValidator.js';
import { validateSession } from './auth/sessionManager.js';
import { getDatabase } from './databaseAdapter.js';
import { fetchSecurityConfig } from './sysConfig.js';

export const applicationCookie = '__Host-imgbed-application';
export const accountCookie = '__Host-imgbed-account';

export function randomToken() {
    return crypto.randomUUID().replaceAll('-', '');
}

export async function digest(value) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
    return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
}

export function cookie(name, value, seconds) {
    return `${name}=${value}; Path=/; Max-Age=${seconds}; Secure; HttpOnly; SameSite=Strict`;
}

export function cookieToken(request, name) {
    const value = (request.headers.get('Cookie') || '').split(';').map(s => s.trim())
        .find(s => s.startsWith(name + '='))?.slice(name.length + 1);
    return /^[0-9a-f]{32}$/.test(value || '') ? value : null;
}

export function json(value, status = 200, headers = {}) {
    return Response.json(value, { status, headers: { 'Cache-Control': 'private, no-store', ...headers } });
}

export function allowRequest(context) {
    if (!context.env.img_d1) return json({ error: '账号服务需要 D1 数据库' }, 503);
    if (context.request.method === 'POST') {
        const origin = context.request.headers.get('Origin');
        if (origin && origin !== new URL(context.request.url).origin) return json({ error: '请求来源无效' }, 403);
    }
    return null;
}

export async function requireAccountAdmin(context) {
    const error = allowRequest(context);
    if (error) return error;
    const security = await fetchSecurityConfig(context.env, { throwOnError: true });
    if (!security.auth?.admin?.adminPassword?.trim()) return json({ error: '请先配置管理员密码' }, 403);
    const token = await validateApiToken(context.request, getDatabase(context.env), 'manage');
    if (token.valid) return null;
    const session = await validateSession(context.env, context.request, 'admin');
    return session.valid ? null : json({ error: '需要管理员权限' }, 403);
}

export async function isVerificationPending(env, token) {
    if (!/^[a-f0-9]{32}$/.test(token || '')) return false;
    return !!await env.img_d1.prepare("SELECT id FROM imgbed_accounts WHERE verification_hash=? AND status='unverified' AND verification_expires>?")
        .bind(await digest(token), Date.now()).first();
}

export async function verifyRegistration(env, token, platform, userId) {
    if (!['telegram', 'discord'].includes(platform) || !/^\d{1,20}$/.test(String(userId)) || !/^[a-f0-9]{32}$/.test(token || '')) return false;
    const result = await env.img_d1.prepare(`UPDATE OR IGNORE imgbed_accounts SET status='pending',platform=?,platform_user_id=?,
        verification_hash=NULL,verification_expires=NULL WHERE verification_hash=? AND status='unverified' AND verification_expires>?`)
        .bind(platform, String(userId), await digest(token), Date.now()).run();
    return result.meta.changes === 1;
}

export async function currentAccount({env,request}) {
    const token = cookieToken(request, accountCookie);
    if (!token || !env.img_d1) return null;
    return env.img_d1.prepare(`SELECT a.id,a.username FROM imgbed_account_sessions s JOIN imgbed_accounts a ON a.id=s.account_id
        WHERE s.token_hash=? AND s.expires>? AND a.status='approved'`).bind(await digest(token), Date.now()).first();
}
