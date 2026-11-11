// 自定义适配器通过请求上下文声明平台；Pages 使用原生 Functions 入口。
// 覆盖同名环境变量，避免用户配置将 Pages/Workers 误判为 Node。
export function onRequest(context) {
    const runtime = context.data.serverRuntime;
    context.env.SERVER_RUNTIME = runtime === 'node' || runtime === 'worker' ? runtime : 'pages';
    // Fail closed for the isolated Hugging Face deployment until credentials are set.
    // No effect on other deployments that do not enable this flag.
    if (context.env.IMGBED_REQUIRE_CONFIGURED_AUTH === 'true') {
        const required = ['BASIC_USER', 'BASIC_PASS', 'AUTH_CODE'];
        const missing = required.some(name =>
            typeof context.env[name] !== 'string' || !context.env[name].trim()
        );
        if (missing) {
            return new Response('ImgBed configuration incomplete', {
                status: 503,
                headers: {
                    'Content-Type': 'text/plain; charset=utf-8',
                    'Cache-Control': 'no-store',
                },
            });
        }
    }
    return context.next();
}
