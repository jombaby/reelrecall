import { cookies } from "next/headers";
export const SESSION_COOKIE="reelrecall_session";const encoder=new TextEncoder();
function base64(bytes:Uint8Array){let value="";for(const byte of bytes)value+=String.fromCharCode(byte);return btoa(value).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"")}
async function sign(value:string){if(!process.env.SESSION_SECRET)throw new Error("SESSION_SECRET is not configured");const key=await crypto.subtle.importKey("raw",encoder.encode(process.env.SESSION_SECRET),{name:"HMAC",hash:"SHA-256"},false,["sign"]);return base64(new Uint8Array(await crypto.subtle.sign("HMAC",key,encoder.encode(value))))}
export async function createSession(){const expires=Date.now()+30*86400000,payload=`owner.${expires}`;return`${payload}.${await sign(payload)}`}
export async function verifySession(token?:string){if(!token)return false;const[owner,expires,signature]=token.split(".");if(owner!=="owner"||!expires||!signature||Number(expires)<Date.now())return false;const expected=await sign(`${owner}.${expires}`);if(signature.length!==expected.length)return false;let mismatch=0;for(let i=0;i<signature.length;i++)mismatch|=signature.charCodeAt(i)^expected.charCodeAt(i);return mismatch===0}
export async function requireOwner(){return verifySession((await cookies()).get(SESSION_COOKIE)?.value)}
