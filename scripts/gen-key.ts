import { JoseKey } from '@atproto/jwk-jose';

const key = await JoseKey.generate(['ES256'], 'key1');
console.log(JSON.stringify(key.privateJwk));
