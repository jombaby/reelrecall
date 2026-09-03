export type SocialVideoInput={url:string;title:string;notes:string};

function decode(value:string){
  return value.replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim();
}

export async function publicDescription(video:SocialVideoInput){
  try{
    const target=new URL(video.url),allowed=["instagram.com","www.instagram.com","facebook.com","www.facebook.com","m.facebook.com","fb.watch","youtube.com","www.youtube.com","youtu.be"];
    if(!allowed.includes(target.hostname))return"";
    if(target.hostname.includes("youtu")){
      const endpoint=`https://www.youtube.com/oembed?url=${encodeURIComponent(video.url)}&format=json`,response=await fetch(endpoint,{signal:AbortSignal.timeout(7000)});
      if(response.ok){const data=await response.json() as {title?:string;author_name?:string};return[data.title,data.author_name].filter(Boolean).join(" — ")}
    }
    const response=await fetch(target,{redirect:"follow",signal:AbortSignal.timeout(7000),headers:{"User-Agent":"Mozilla/5.0 (compatible; ReelRecall/1.0)","Accept-Language":"en-US,en;q=0.9"}});
    if(!response.ok)return"";
    const html=await response.text();
    const description=html.match(/<meta[^>]+(?:property|name)=["'](?:og:description|description)["'][^>]+content=["']([^"']+)["']/i)?.[1]??html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:description|description)["']/i)?.[1]??"";
    return decode(description).slice(0,6000);
  }catch{return""}
}
