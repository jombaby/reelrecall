import { NextRequest, NextResponse } from "next/server";

export async function GET(request:NextRequest){
  const raw=request.nextUrl.searchParams.get("url");
  if(!raw)return NextResponse.json({error:"Missing URL"},{status:400});
  try{
    const url=new URL(raw);
    if(!["instagram.com","www.instagram.com"].includes(url.hostname))throw new Error("Unsupported host");
    const parts=url.pathname.split("/").filter(Boolean),code=parts[1];
    if(!code)throw new Error("Invalid Instagram URL");
    const canonical=`https://www.instagram.com/reel/${code}/`;
    const endpoint=new URL("https://graph.facebook.com/v24.0/instagram_oembed");
    endpoint.searchParams.set("url",canonical);endpoint.searchParams.set("omitscript","true");
    const response=await fetch(endpoint,{signal:AbortSignal.timeout(8000),headers:{Accept:"application/json"}});
    if(!response.ok)throw new Error("Embed unavailable");
    const data=await response.json() as {html?:string};
    if(!data.html)throw new Error("Embed unavailable");
    return NextResponse.json({html:data.html},{headers:{"Cache-Control":"public, max-age=3600, s-maxage=86400"}})
  }catch{return NextResponse.json({error:"Instagram embed unavailable"},{status:404,headers:{"Cache-Control":"public, max-age=600"}})}
}
