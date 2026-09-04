import { NextRequest, NextResponse } from "next/server";

const FACEBOOK_HOSTS=new Set(["facebook.com","www.facebook.com","m.facebook.com","fb.watch"]);

function cleanUrl(value:string){return String(value||"").trim().replace(/[)>\],.!?]+$/,"")}

function canonicalizeFacebookUrl(input:string){
  const raw=cleanUrl(input); if(!raw)return raw;
  try{
    const url=new URL(raw);
    if(!FACEBOOK_HOSTS.has(url.hostname.toLowerCase()))return raw;
    ["mibextid","wa_status_inline","igsh","share_url","sfnsn","rdid","utm_source","utm_medium","utm_campaign","utm_content","feature","ref"].forEach(k=>url.searchParams.delete(k));
    const path=url.pathname.replace(/\/+/g,"/");
    const reel=path.match(/\/reels?\/([A-Za-z0-9._-]+)/i)?.[1];
    if(reel)return `https://www.facebook.com/reel/${reel}`;
    const video=path.match(/\/videos\/([0-9]+)/i)?.[1];
    if(video)return `https://www.facebook.com/watch/?v=${video}`;
    const watch=url.searchParams.get("v");
    if(watch&&/^\d+$/.test(watch))return `https://www.facebook.com/watch/?v=${watch}`;
    url.protocol="https:"; url.hostname="www.facebook.com"; url.hash=""; url.searchParams.sort();
    return url.toString().replace(/\?$/,"").replace(/\/$/,"");
  }catch{return raw}
}

function canonicalizeSharedUrl(input:string){
  const raw=cleanUrl(input); if(!raw)return raw;
  try{
    const url=new URL(raw);
    if(FACEBOOK_HOSTS.has(url.hostname.toLowerCase()))return canonicalizeFacebookUrl(raw);
    url.hash="";
    ["igsh","igshid","mibextid","utm_source","utm_medium","utm_campaign","utm_content","si","feature"].forEach(k=>url.searchParams.delete(k));
    if(["instagram.com","www.instagram.com"].includes(url.hostname.toLowerCase())){
      url.protocol="https:"; url.hostname="www.instagram.com"; url.pathname=url.pathname.replace(/^\/reels\//i,"/reel/");
    }
    url.pathname=url.pathname.replace(/\/$/,""); url.searchParams.sort();
    return url.toString().replace(/\?$/,"");
  }catch{return raw}
}

function isResolvedFacebook(value:string){
  return /facebook\.com\/reel\/[^/?#]+/i.test(value)||/facebook\.com\/watch\/?\?v=\d+/i.test(value);
}

async function resolveFacebookShareUrl(input:string){
  const original=canonicalizeFacebookUrl(input);
  if(isResolvedFacebook(original))return original;
  let parsed:URL; try{parsed=new URL(original)}catch{return original}
  const needs=parsed.hostname.toLowerCase()==="fb.watch"||/\/share\/(?:r|v)\//i.test(parsed.pathname);
  if(!needs)return original;
  const candidates=[original,original.replace("www.facebook.com","m.facebook.com")].filter((v,i,a)=>v&&a.indexOf(v)===i);
  for(const candidate of candidates){
    try{
      const response=await fetch(candidate,{redirect:"follow",cache:"no-store",headers:{
        "User-Agent":"Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Mobile Safari/537.36",
        "Accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8","Accept-Language":"en-US,en;q=0.9"
      },signal:AbortSignal.timeout(15000)});
      const finalUrl=canonicalizeFacebookUrl(response.url||candidate);
      if(isResolvedFacebook(finalUrl))return finalUrl;
      const html=(await response.text()).slice(0,1500000);
      for(const pattern of [
        String.raw`https:\\/\\/www\.facebook\.com\\/reel\\/([A-Za-z0-9._-]+)`,
        String.raw`https://www\.facebook\.com/reel/([A-Za-z0-9._-]+)`,
        String.raw`facebook\.com\\/reel\\/([A-Za-z0-9._-]+)`,
        String.raw`facebook\.com/reel/([A-Za-z0-9._-]+)`
      ]){
        const match=html.match(new RegExp(pattern,"i"));
        if(match?.[1])return `https://www.facebook.com/reel/${match[1]}`;
      }
      const videoId=html.match(/"video_id":"(\d+)"/i)?.[1]||html.match(/"videoID":"(\d+)"/i)?.[1]||html.match(/"videoId":"(\d+)"/i)?.[1]||html.match(/"video_id":(\d+)/i)?.[1];
      if(videoId)return `https://www.facebook.com/watch/?v=${videoId}`;
    }catch(error){console.warn("[shared-url-resolver]",candidate,error instanceof Error?error.message:"resolution failed")}
  }
  return original;
}

function identityFor(input:string){
  const canonical=canonicalizeSharedUrl(input);
  try{
    const url=new URL(canonical),host=url.hostname.replace(/^www\./,"").toLowerCase();
    if(host==="facebook.com"){
      const reel=url.pathname.match(/\/reels?\/([A-Za-z0-9._-]+)/i)?.[1]; if(reel)return `facebook:reel:${reel}`;
      const watch=url.searchParams.get("v"); if(watch&&/^\d+$/.test(watch))return `facebook:video:${watch}`;
    }
    if(host==="instagram.com"){
      const reel=url.pathname.match(/\/(?:reel|reels|p)\/([^/?#]+)/i)?.[1]; if(reel)return `instagram:${reel}`;
    }
    return canonical.toLowerCase();
  }catch{return canonical.toLowerCase()}
}

export async function GET(request:NextRequest){
  const raw=cleanUrl(request.nextUrl.searchParams.get("url")||"");
  if(!raw)return NextResponse.json({ok:false,error:"Missing URL"},{status:400});
  let parsed:URL; try{parsed=new URL(raw)}catch{return NextResponse.json({ok:false,error:"Invalid URL"},{status:400})}
  let resolved=canonicalizeSharedUrl(raw);
  if(FACEBOOK_HOSTS.has(parsed.hostname.toLowerCase()))resolved=await resolveFacebookShareUrl(raw);
  resolved=canonicalizeSharedUrl(resolved);
  return NextResponse.json({ok:true,originalUrl:raw,resolvedUrl:resolved,canonicalUrl:resolved,identity:identityFor(resolved),changed:resolved!==raw});
}
