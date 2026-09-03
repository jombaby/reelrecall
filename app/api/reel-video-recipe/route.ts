import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

type Source = "Instagram" | "Facebook";
type VideoInput = { url:string; title:string; notes:string; source:Source };
type RecipeResult = { available:boolean; title:string; ingredients:string[]; steps:string[]; notes:string; servings:string; prepTime:string };
type ActorRow = Record<string,unknown>;
type MediaEvidence = { caption:string; transcript:string; onScreenText:string; thumbnail:string; evidence:string[] };

function actorId(value:string){return value.replace("/","~")}
function asText(value:unknown){return typeof value==="string"?value.trim():""}
function firstText(row:ActorRow,keys:string[]){for(const key of keys){const value=asText(row[key]);if(value)return value}return""}
function firstUrl(row:ActorRow,keys:string[]){for(const key of keys){const value=asText(row[key]);if(/^https?:\/\//i.test(value))return value}return""}
function rowError(row:ActorRow){return firstText(row,["error","errorMessage","message","statusMessage"])}

function analysis(source:Source,media:MediaEvidence,status:"success"|"partial"|"error",message:string,error=""){
  return{status,source,caption:media.caption,transcript:media.transcript,onScreenText:media.onScreenText,thumbnail:media.thumbnail,evidence:media.evidence,retrievedAt:new Date().toISOString(),message,error};
}


async function resolveFacebookShareUrl(rawUrl:string){
  try{
    const initial=new URL(rawUrl);

    const clean=(value:string)=>{
      try{
        const u=new URL(value);
        u.hash="";
        ["mibextid","fbclid","utm_source","utm_medium","utm_campaign","utm_content"].forEach(k=>u.searchParams.delete(k));
        const reelId=u.pathname.match(/\/reel\/(\d+)/i)?.[1];
        if(reelId)return `https://www.facebook.com/reel/${reelId}`;
        if(u.hostname==="m.facebook.com")u.hostname="www.facebook.com";
        return u.toString().replace(/\?$/,"").replace(/\/$/,"");
      }catch{return value}
    };

    const alreadyReel=initial.pathname.match(/\/reel\/(\d+)/i)?.[1];
    if(alreadyReel)return `https://www.facebook.com/reel/${alreadyReel}`;

    const isFacebook=/^(?:www\.|m\.)?facebook\.com$/i.test(initial.hostname)||initial.hostname==="fb.watch";
    if(!isFacebook)return rawUrl;

    const response=await fetch(rawUrl,{
      method:"GET",
      redirect:"follow",
      cache:"no-store",
      signal:AbortSignal.timeout(15000),
      headers:{
        "User-Agent":"Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
        "Accept":"text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language":"en-US,en;q=0.9"
      }
    });

    const redirected=clean(response.url);
    if(/facebook\.com\/reel\/\d+/i.test(redirected))return redirected;

    const html=(await response.text()).slice(0,1500000);

    const canonical=
      html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)?.[1] ??
      html.match(/<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i)?.[1] ??
      "";

    if(canonical){
      const normalized=clean(canonical.replace(/\\\//g,"/"));
      if(/facebook\.com\/reel\/\d+/i.test(normalized))return normalized;
    }

    const escaped=html.match(/facebook\\?\.com\\?\/reel\\?\/(\d+)/i)?.[1];
    if(escaped)return `https://www.facebook.com/reel/${escaped}`;

    const plain=html.match(/facebook\.com\/reel\/(\d+)/i)?.[1];
    if(plain)return `https://www.facebook.com/reel/${plain}`;

    return clean(rawUrl);
  }catch{
    return rawUrl;
  }
}

async function canonicalizeFacebookUrls(value:unknown):Promise<unknown>{
  if(typeof value==="string"){
    if(/^https?:\/\/(?:(?:www|m)\.)?facebook\.com\/(?:share\/(?:r|v)\/|reel\/)|^https?:\/\/fb\.watch\//i.test(value)){
      return await resolveFacebookShareUrl(value);
    }
    return value;
  }

  if(Array.isArray(value)){
    return await Promise.all(value.map(item=>canonicalizeFacebookUrls(item)));
  }

  if(value&&typeof value==="object"){
    const entries=await Promise.all(
      Object.entries(value as Record<string,unknown>).map(async([key,item])=>[key,await canonicalizeFacebookUrls(item)] as const)
    );
    return Object.fromEntries(entries);
  }

  return value;
}

async function runActor(actor:string,input:unknown,seconds=120){
  const resolvedInput=await canonicalizeFacebookUrls(input);
  const token=process.env.APIFY_TOKEN;if(!token)throw new Error("APIFY_TOKEN is not configured in Vercel");
  const endpoint=`https://api.apify.com/v2/actors/${actorId(actor)}/run-sync-get-dataset-items?timeout=${seconds}&clean=true&limit=5`;
  let response:Response;
  try{response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},body:JSON.stringify(resolvedInput),signal:AbortSignal.timeout((seconds+15)*1000),cache:"no-store"})}
  catch(error){throw new Error(`${actor}: Apify request failed (${error instanceof Error?error.message:"network error"})`)}
  const raw=await response.text();
  if(!response.ok){let detail=raw.slice(0,500);try{const parsed=JSON.parse(raw) as {error?:{message?:string;type?:string}};detail=parsed.error?.message||parsed.error?.type||detail}catch{}throw new Error(`${actor}: Apify returned ${response.status}${detail?` — ${detail}`:""}`)}
  try{const parsed=JSON.parse(raw) as unknown;if(!Array.isArray(parsed))throw new Error("dataset response was not an array");return parsed as ActorRow[]}
  catch(error){throw new Error(`${actor}: invalid Apify result (${error instanceof Error?error.message:"invalid JSON"})`)}
}

async function instagramEvidence(video:VideoInput):Promise<MediaEvidence>{
  const actor=process.env.APIFY_INSTAGRAM_VIDEO_ACTOR||"automation-lab/instagram-reel-ocr-hooks";
  const rows=await runActor(actor,{startUrls:[{url:video.url}],maxItems:1,frameIntervalSeconds:3,hookWindowSeconds:6,ocrLanguage:"eng",includeTranscript:true,maxVideoDurationSeconds:180,proxyConfiguration:{useApifyProxy:false}},150);
  const row=rows[0]||{},actorError=rowError(row),transcript=firstText(row,["transcript"]),onScreenText=firstText(row,["onScreenText","hookText"]),caption=firstText(row,["caption","description"]),thumbnail=firstUrl(row,["thumbnailUrl","displayUrl","imageUrl"]);
  if(!transcript&&!onScreenText&&!caption)throw new Error(actorError||"Instagram reel returned no transcript, caption, or readable on-screen text");
  return{caption,transcript,onScreenText,thumbnail,evidence:[transcript?"Spoken narration":"",onScreenText?"On-screen text from sampled reel frames":"",caption?"Instagram reel caption":"",thumbnail?"Reel preview image":""].filter(Boolean)};
}

async function facebookEvidence(video:VideoInput):Promise<MediaEvidence>{
  const errors:string[]=[];let caption="",transcript="",thumbnail="";
  const scraperActor=process.env.APIFY_FACEBOOK_VIDEO_ACTOR||"apivault_labs/facebook-reels-video-scraper";
  try{const rows=await runActor(scraperActor,{startUrls:[video.url],maxResults:1,maxCostUsd:.10,downloadMp4:false,includeTranscript:true,proxyCountry:"US",maxConcurrency:1,timeout:60,maxRetries:1},90);const row=rows[0]||{},err=rowError(row);if(err)errors.push(`${scraperActor}: ${err}`);caption=firstText(row,["caption","description","title"]);transcript=firstText(row,["transcript","transcriptText","transcriptSummary"]);thumbnail=firstUrl(row,["thumbnailUrl","thumbnail","imageUrl"])}catch(error){errors.push(error instanceof Error?error.message:`${scraperActor}: failed`)}
  if(!transcript){const transcriptActor=process.env.APIFY_FACEBOOK_TRANSCRIPT_ACTOR||"automation-lab/facebook-video-transcript-extractor";try{const rows=await runActor(transcriptActor,{videoUrls:[video.url],maxItems:1,language:"auto",includeWordTimestamps:false,maxVideoDurationSeconds:180},150);const row=rows[0]||{},err=rowError(row);if(err)errors.push(`${transcriptActor}: ${err}`);transcript=firstText(row,["transcript","text"]);if(!caption)caption=firstText(row,["title","description"]);if(!thumbnail)thumbnail=firstUrl(row,["thumbnailUrl","thumbnail","imageUrl"])}catch(error){errors.push(error instanceof Error?error.message:`${transcriptActor}: failed`)}}
  if(!caption&&!transcript)throw new Error(errors.filter(Boolean).join(" | ")||"Facebook reel returned no public caption or spoken transcript");
  return{caption,transcript,onScreenText:"",thumbnail,evidence:[transcript?"Spoken narration":"",caption?"Facebook reel caption":"",thumbnail?"Reel preview image":""].filter(Boolean)};
}

export async function POST(request:NextRequest){
  let source:Source="Facebook";let media:MediaEvidence={caption:"",transcript:"",onScreenText:"",thumbnail:"",evidence:[]};
  try{
    const body=await request.json() as {video?:VideoInput},video=body.video;
    if(!video?.url||!video.title||!(["Facebook","Instagram"] as string[]).includes(video.source))return NextResponse.json({analysis:analysis(source,media,"error","Invalid analysis request","A Facebook or Instagram reel is required"),recipe:null,error:"A Facebook or Instagram reel is required"},{status:400});
    source=video.source;
    if(!process.env.APIFY_TOKEN)return NextResponse.json({analysis:analysis(source,media,"error","Reel retrieval could not start.","APIFY_TOKEN is not configured in Vercel. Add it and redeploy."),recipe:null,error:"APIFY_TOKEN is not configured in Vercel. Add it and redeploy."},{status:503});
    if(!process.env.OPENAI_API_KEY)return NextResponse.json({analysis:analysis(source,media,"error","Reel retrieval could not start.","OPENAI_API_KEY is not configured"),recipe:null,error:"OPENAI_API_KEY is not configured"},{status:503});

    try{media=source==="Instagram"?await instagramEvidence(video):await facebookEvidence(video)}
    catch(error){const message=error instanceof Error?error.message:"Could not retrieve reel";console.error("[reel-video-recipe retrieval]",message);return NextResponse.json({analysis:analysis(source,media,"error","ReelRecall could not retrieve usable public reel evidence.",message),recipe:null,error:message},{status:502})}

    const evidenceText=[video.notes?`Saved notes:\n${video.notes}`:"",media.caption?`Reel caption:\n${media.caption}`:"",media.transcript?`Spoken narration transcript:\n${media.transcript}`:"",media.onScreenText?`Text read from sampled video frames:\n${media.onScreenText}`:""].filter(Boolean).join("\n\n").slice(0,24000);
    if(!evidenceText.trim())return NextResponse.json({analysis:analysis(source,media,"partial","The reel was retrieved, but it did not expose enough caption, narration, or on-screen text for recipe generation."),recipe:null,message:"No usable recipe evidence was returned."});

    try{
      const content:Array<Record<string,unknown>>=[{type:"input_text",text:JSON.stringify({source,title:video.title,url:video.url,extractedEvidence:evidenceText})}];if(media.thumbnail)content.push({type:"input_image",image_url:media.thumbnail,detail:"low"});
      const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({model:"gpt-5.6-luna",reasoning:{effort:"none"},max_output_tokens:1600,input:[{role:"system",content:[{type:"input_text",text:"Create a cooking recipe only from evidence extracted from the selected reel: narration, on-screen text/OCR, caption, and preview image. Do not invent exact quantities, temperatures, cooking times, or ingredients. If an ingredient or action is clear but its amount is absent, use 'amount not specified'. Preserve the sequence of preparation steps. Set available=false only when the evidence is genuinely insufficient to produce a useful recipe with at least one ingredient and one preparation or cooking step."}]},{role:"user",content}],text:{format:{type:"json_schema",name:"reel_recipe_analysis",strict:true,schema:{type:"object",additionalProperties:false,properties:{available:{type:"boolean"},title:{type:"string"},ingredients:{type:"array",items:{type:"string"}},steps:{type:"array",items:{type:"string"}},notes:{type:"string"},servings:{type:"string"},prepTime:{type:"string"}},required:["available","title","ingredients","steps","notes","servings","prepTime"]}}}}),signal:AbortSignal.timeout(45000)});
      if(!response.ok){const raw=await response.text();throw new Error(`AI recipe analysis failed (${response.status})${raw?` — ${raw.slice(0,300)}`:""}`)}
      const data=await response.json() as {output?:Array<{content?:Array<{type?:string;text?:string}>}>},outputText=data.output?.flatMap(item=>item.content||[]).find(item=>item.type==="output_text")?.text;if(!outputText)throw new Error("AI returned no recipe result");
      const result=JSON.parse(outputText) as RecipeResult;
      if(!result.available||!result.ingredients.length||!result.steps.length)return NextResponse.json({analysis:analysis(source,media,"partial","Reel evidence was retrieved successfully, but AI could not identify enough reliable recipe detail."),recipe:null,message:"AI could not produce a reliable recipe from the fetched evidence."});
      const recipe={title:result.title.trim()||video.title,ingredients:result.ingredients.map(x=>x.trim()).filter(Boolean).slice(0,50),steps:result.steps.map(x=>x.trim()).filter(Boolean).slice(0,40),notes:result.notes.trim(),servings:result.servings.trim(),prepTime:result.prepTime.trim(),extractedAt:new Date().toISOString(),source:"video" as const,evidence:media.evidence};
      return NextResponse.json({analysis:analysis(source,media,"success","Reel evidence was retrieved and a recipe proposal was generated. Review it before saving."),recipe});
    }catch(error){const message=error instanceof Error?error.message:"AI recipe generation failed";console.error("[reel-video-recipe AI]",message);return NextResponse.json({analysis:analysis(source,media,"partial","The reel was retrieved successfully, but AI recipe generation failed.",message),recipe:null,message:"You can still review the fetched reel evidence below."})}
  }catch(error){const message=error instanceof Error?error.message:"Could not analyze reel";console.error("[reel-video-recipe]",message);return NextResponse.json({analysis:analysis(source,media,"error","Reel analysis failed.",message),recipe:null,error:message},{status:500})}
}
