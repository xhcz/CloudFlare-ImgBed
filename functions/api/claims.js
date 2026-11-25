import { handleClaims } from '../utils/fileClaims.js';
export const onRequest = context => handleClaims(context);
