export const el = id => document.getElementById(id);
export const states = { unverified:'等待 Bot 验证', pending:'等待管理员审核', approved:'已通过', rejected:'已拒绝' };

export async function api(path, data) {
    const options = {credentials:'same-origin',cache:'no-store'};
    if (data !== undefined) Object.assign(options, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const response = await fetch('/api/' + path, options);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(result.error || result.message || ('请求失败 ' + response.status)), {status:response.status});
    return result;
}

export function run(action) {
    return async event => {
        event?.preventDefault();
        const control = event?.submitter || event?.currentTarget;
        if (control?.disabled) return;
        if (control) control.disabled = true;
        try { el('notice').textContent = ''; await action(event); }
        catch (error) { el('notice').textContent = error.message; }
        finally { if (control) control.disabled = false; }
    };
}

export function node(tag, text) {
    const element = document.createElement(tag);
    element.textContent = text;
    return element;
}

export function list(id, rows, render, empty) {
    el(id).replaceChildren(...(rows.length ? rows.map(render) : [node('p',empty)]));
}
