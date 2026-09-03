export type SocialVideoInput={url:string;title:string;notes:string};

function decodeHtml(value:string){
  return value
    .replace(/&amp;/gi,"&")
    .replace(/&quot;/gi,'"')
    .replace(/&#39;|&#x27;/gi,"'")
    .replace(/&lt;/gi,"<")
    .replace(/&gt;/gi,">")
    .replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n)))
    .replace(/<br\s*\/?>/gi,"\n")
    .replace(/<[^>]*>/g," ")
    .replace(/[ \t]+/g," ")
    .replace(/\n{3,}/g,"\n\n")
    .trim();
}

function decodeJsonString(value:string){
  try{return JSON.parse('"'+value.replace(/"/g,'\\"')+'"')}
  catch{
    return value
      .replace(/\\n/g,"\n")
      .replace(/\\r/g,"\n")
      .replace(/\\t/g," ")
      .replace(/\\u([0-9a-fA-F]{4})/g,(_,h)=>String.fromCharCode(parseInt(h,16)))
      .replace(/\\"/g,'"')
      .replace(/\\\\/g,"\\");
  }
}

function useful(value:string){
  const v=decodeHtml(value).trim();
  if(!v || v.length<20) return "";
  if(/log in|sign up|create new account|see more on facebook|facebook helps you connect/i.test(v) && v.length<220) return "";
  return v.slice(0,12000);
}

function recipeSignalScore(value:string){
  const s=value.toLowerCase();
  let score=Math.min(value.length/400,5);
  const units=["cup","cups","tbsp","tablespoon","tsp","teaspoon","gram","grams","kg","oz","ounce","ml","lb","°f","°c"];
  const actions=["add","mix","cook","bake","boil","fry","roast","stir","chop","slice","season","heat","simmer","blend","whisk","pour"];
  const ingredients=["salt","pepper","oil","butter","garlic","onion","flour","sugar","chicken","beef","egg","milk","cream","cheese"];
  for(const x of units) if(s.includes(x)) score+=2;
  for(const x of actions) if(new RegExp("\\b"+x+"\\b").test(s)) score+=1;
  for(const x of ingredients) if(new RegExp("\\b"+x+"\\b").test(s)) score+=0.5;
  if(/\d+\s*(?:\/\s*\d+)?/.test(s)) score+=2;
  if(s.split(/\n|[.!?]\s+/).length>=3) score+=1;
  return score;
}

function extractCandidates(html:string){
  const found:string[]=[];
  const add=(raw?:string)=>{if(!raw)return;const v=useful(raw);if(v)found.push(v)};

  for(const re of [
    /<meta[^>]+(?:property|name)=["'](?:og:description|description|twitter:description)["'][^>]+content=["']([\s\S]*?)["'][^>]*>/gi,
    /<meta[^>]+content=["']([\s\S]*?)["'][^>]+(?:property|name)=["'](?:og:description|description|twitter:description)["'][^>]*>/gi
  ]){
    let m; while((m=re.exec(html))) add(m[1]);
  }

  for(const re of [
    /"(?:description|message|caption|story_text|text)"\s*:\s*"((?:\\.|[^"\\]){20,12000})"/gi,
    /&quot;(?:description|message|caption|story_text|text)&quot;\s*:\s*&quot;([\s\S]{20,12000}?)&quot;/gi
  ]){
    let m; while((m=re.exec(html))){
      add(decodeJsonString(m[1]));
      if(found.length>80) break;
    }
  }

  const bodyText=decodeHtml(html.replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," "));
  if(bodyText.length>=80) add(bodyText);

  return [...new Set(found)].sort((a,b)=>recipeSignalScore(b)-recipeSignalScore(a));
}

async function getText(url:string){
  try{
    const response=await fetch(url,{
      redirect:"follow",
      signal:AbortSignal.timeout(9000),
      headers:{
        "User-Agent":"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
        "Accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language":"en-US,en;q=0.9",
        "Cache-Control":"no-cache"
      }
    });
    if(!response.ok)return"";
    return (await response.text()).slice(0,2500000);
  }catch{return""}
}

export function facebookPluginCandidates(rawUrl:string){
  try{
    const u=new URL(rawUrl);
    const id=u.pathname.match(/\/reel\/(\d+)/i)?.[1];
    const canonical=id?`https://www.facebook.com/reel/${id}`:rawUrl;
    return [
      canonical,
      canonical.replace("://www.facebook.com/","://m.facebook.com/"),
      `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(canonical)}&show_text=true&width=500`,
      `https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(canonical)}&show_text=true&width=500`
    ];
  }catch{return[rawUrl]}
}

export async function publicDescription(video:SocialVideoInput){
  try{
    const target=new URL(video.url);
    const allowed=["instagram.com","www.instagram.com","facebook.com","www.facebook.com","m.facebook.com","fb.watch","youtube.com","www.youtube.com","youtu.be"];
    if(!allowed.includes(target.hostname))return"";

    if(target.hostname.includes("youtu")){
      const endpoint=`https://www.youtube.com/oembed?url=${encodeURIComponent(video.url)}&format=json`;
      const response=await fetch(endpoint,{signal:AbortSignal.timeout(7000)});
      if(response.ok){
        const data=await response.json() as {title?:string;author_name?:string};
        return [data.title,data.author_name].filter(Boolean).join(" — ");
      }
    }

    const urls=(target.hostname.includes("facebook.com")||target.hostname==="fb.watch")
      ? facebookPluginCandidates(video.url)
      : [video.url];

    const candidates:string[]=[];
    for(const url of urls){
      const html=await getText(url);
      if(!html)continue;
      candidates.push(...extractCandidates(html));
      const excellent=candidates.find(x=>recipeSignalScore(x)>=10 && x.length>=120);
      if(excellent)return excellent.slice(0,12000);
    }

    return candidates.sort((a,b)=>recipeSignalScore(b)-recipeSignalScore(a))[0]?.slice(0,12000)??"";
  }catch{return""}
}
