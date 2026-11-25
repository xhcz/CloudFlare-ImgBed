import { json,listBots } from '../../utils/verificationBots.js';
export async function onRequest(context) {
    if (context.request.method !== 'GET') return json({},405);
    return json({bots:await listBots(context,false)});
}
