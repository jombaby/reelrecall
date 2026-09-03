import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

// APIFY_DIAGNOSTIC_V2
type Source = "Instagram" | "Facebook";
type VideoInput = { url: string; title: string; notes: string; source: Source };
type RecipeResult = { available:boolean; title:string; ingredients:string[]; steps:string[]; notes:string; servings:string; prepTime:string };
type ActorRow = Record<string, unknown>;

function actorId(value:string){return value.replace("/", "~")}
function asText(value:unknown){return typeof value === "string" ? value.trim() : ""}
function firstText(row:ActorRow, keys:string[]){for(const key of keys){const value=asText(row[key]);if(value)return value}return""}
function firstUrl(row:ActorRow, keys:string[]){for(const key of keys){const value=asText(row[key]);if(/^https?:\/\//i.test(value))return value}return""}
function rowError(row:ActorRow){return firstText(row,["error","errorMessage","message","statusMessage"])}

async function runActor(actor:string,input:unknown,seconds=120){
  const token=process.env.APIFY_TOKEN;
  if(!token)throw new Error("APIFY_TOKEN is not configured in Vercel");
  const endpoint=`https://api.apify.com/v2/actors/${actorId(actor)}/run-sync-get-dataset-items?timeout=${seconds}&clean=true&limit=5`;
  let response:Response;
  try{
    response=await fetch(endpoint,{
      method:"POST",
      headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`},
      body:JSON.stringify(input),
      signal:AbortSignal.timeout((seconds+15)*1000),
      cache:"no-store"
    });
  }catch(error){
    const message=error instanceof Error?error.message:"network error";
    throw new Error(`${actor}: Apify request failed (${message})`);
  }
  const raw=await response.text();
  if(!response.ok){
    let detail=raw.slice(0,500);
    try{const parsed=JSON.parse(raw) as {error?:{message?:string;type?:string}};detail=parsed.error?.message||parsed.error?.type||detail}catch{}
    throw new Error(`${actor}: Apify returned ${response.status}${detail?` — ${detail}`:""}`);
  }
  try{
    const parsed=JSON.parse(raw) as unknown;
    if(!Array.isArray(parsed))throw new Error("dataset response was not an array");
    return parsed as ActorRow[];
  }catch(error){
    const message=error instanceof Error?error.message:"invalid JSON";
    throw new Error(`${actor}: invalid Apify result (${message})`);
  }
}

async function instagramEvidence(video:VideoInput){
  const actor=process.env.APIFY_INSTAGRAM_VIDEO_ACTOR||"automation-lab/instagram-reel-ocr-hooks";
  const rows=await runActor(actor,{
    startUrls:[{url:video.url}],
    maxItems:1,
    frameIntervalSeconds:3,
    hookWindowSeconds:6,
    ocrLanguage:"eng",
    includeTranscript:true,
    maxVideoDurationSeconds:180,
    proxyConfiguration:{useApifyProxy:false}
  },150);
  const row=rows[0]||{};
  const actorError=rowError(row);
  const transcript=firstText(row,["transcript"]);
  const onScreenText=firstText(row,["onScreenText","hookText"]);
  const caption=firstText(row,["caption","description"]);
  const thumbnail=firstUrl(row,["thumbnailUrl","displayUrl","imageUrl"]);
  if(!transcript&&!onScreenText&&!caption)throw new Error(actorError||"Instagram reel returned no transcript, caption, or readable on-screen text");
  return{caption,transcript,onScreenText,thumbnail,evidence:[transcript?"Spoken narration":"",onScreenText?"On-screen text from sampled reel frames":"",caption?"Instagram reel caption":"",thumbnail?"Reel preview image":""].filter(Boolean)};
}

async function facebookEvidence(video:VideoInput){
  const errors:string[]=[];
  let caption="",transcript="",thumbnail="";
  const scraperActor=process.env.APIFY_FACEBOOK_VIDEO_ACTOR||"apivault_labs/facebook-reels-video-scraper";
  try{
    const rows=await runActor(scraperActor,{
      startUrls:[video.url],
      maxResults:1,
      maxCostUsd:0.10,
      downloadMp4:false,
      includeTranscript:true,
      proxyCountry:"US",
      maxConcurrency:1,
      timeout:60,
      maxRetries:1
    },90);
    const row=rows[0]||{};
    const err=rowError(row);if(err)errors.push(`${scraperActor}: ${err}`);
    caption=firstText(row,["caption","description","title"]);
    transcript=firstText(row,["transcript","transcriptText","transcriptSummary"]);
    thumbnail=firstUrl(row,["thumbnailUrl","thumbnail","imageUrl"]);
  }catch(error){errors.push(error instanceof Error?error.message:`${scraperActor}: failed`)}

  if(!transcript){
    const transcriptActor=process.env.APIFY_FACEBOOK_TRANSCRIPT_ACTOR||"automation-lab/facebook-video-transcript-extractor";
    try{
      const rows=await runActor(transcriptActor,{
        videoUrls:[video.url],
        maxItems:1,
        language:"auto",
        includeWordTimestamps:false,
        maxVideoDurationSeconds:180
      },150);
      const row=rows[0]||{};
      const err=rowError(row);if(err)errors.push(`${transcriptActor}: ${err}`);
      transcript=firstText(row,["transcript","text"]);
      if(!caption)caption=firstText(row,["title","description"]);
      if(!thumbnail)thumbnail=firstUrl(row,["thumbnailUrl","thumbnail","imageUrl"]);
    }catch(error){errors.push(error instanceof Error?error.message:`${transcriptActor}: failed`)}
  }

  if(!caption&&!transcript){
    const detail=errors.filter(Boolean).join(" | ");
    throw new Error(detail||"Facebook reel returned no public caption or spoken transcript");
  }

  return{caption,transcript,onScreenText:"",thumbnail,evidence:[transcript?"Spoken narration":"",caption?"Facebook reel caption":"",thumbnail?"Reel preview image":""].filter(Boolean)};
}

export async function POST(request:NextRequest){
  if(!process.env.OPENAI_API_KEY)return NextResponse.json({error:"OPENAI_API_KEY is not configured"},{status:503});
  if(!process.env.APIFY_TOKEN)return NextResponse.json({error:"APIFY_TOKEN is not configured in Vercel. Add it and redeploy."},{status:503});
  try{
    const body=await request.json() as {video?:VideoInput};
    const video=body.video;
    if(!video?.url||!video.title||!["Facebook","Instagram"].includes(video.source))return NextResponse.json({error:"A Facebook or Instagram reel is required"},{status:400});
    const media=video.source==="Instagram"?await instagramEvidence(video):await facebookEvidence(video);
    const evidenceText=[
      video.notes?`Saved notes:\n${video.notes}`:"",
      media.caption?`Reel caption:\n${media.caption}`:"",
      media.transcript?`Spoken narration transcript:\n${media.transcript}`:"",
      media.onScreenText?`Text read from sampled video frames:\n${media.onScreenText}`:""
    ].filter(Boolean).join("\n\n").slice(0,24000);
    if(!evidenceText.trim())return NextResponse.json({recipe:null,message:"The reel was retrieved, but it did not expose enough caption, narration, or on-screen text for recipe analysis."});

    const content:Array<Record<string,unknown>>=[{type:"input_text",text:JSON.stringify({source:video.source,title:video.title,url:video.url,extractedEvidence:evidenceText})}];
    if(media.thumbnail)content.push({type:"input_image",image_url:media.thumbnail,detail:"low"});

    const response=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},
      body:JSON.stringify({
        model:"gpt-5.6-luna",
        reasoning:{effort:"none"},
        max_output_tokens:1600,
        input:[
          {role:"system",content:[{type:"input_text",text:"Create a cooking recipe only from evidence extracted from the selected reel: narration, on-screen text/OCR, caption, and preview image. Do not invent exact quantities, temperatures, cooking times, or ingredients. If an ingredient or action is clear but its amount is absent, use 'amount not specified'. Preserve the sequence of preparation steps. Set available=false only when the evidence is genuinely insufficient to produce a useful recipe with at least one ingredient and one preparation or cooking step."}]},
          {role:"user",content}
        ],
        text:{format:{type:"json_schema",name:"reel_recipe_analysis",strict:true,schema:{
          type:"object",additionalProperties:false,
          properties:{
            available:{type:"boolean"},
            title:{type:"string"},
            ingredients:{type:"array",items:{type:"string"}},
            steps:{type:"array",items:{type:"string"}},
            notes:{type:"string"},
            servings:{type:"string"},
            prepTime:{type:"string"}
          },
          required:["available","title","ingredients","steps","notes","servings","prepTime"]
        }}}
      }),
      signal:AbortSignal.timeout(45000)
    });

    if(!response.ok){
      const raw=await response.text();
      throw new Error(`AI recipe analysis failed (${response.status})${raw?` — ${raw.slice(0,300)}`:""}`);
    }

    const data=await response.json() as {output?:Array<{content?:Array<{type?:string;text?:string}>}>};
    const outputText=data.output?.flatMap(item=>item.content||[]).find(item=>item.type==="output_text")?.text;
    if(!outputText)throw new Error("AI returned no recipe result");
    const result=JSON.parse(outputText) as RecipeResult;

    if(!result.available||!result.ingredients.length||!result.steps.length)return NextResponse.json({recipe:null,message:"AI analyzed the reel evidence but could not identify enough reliable recipe detail."});

    return NextResponse.json({recipe:{
      title:result.title.trim()||video.title,
      ingredients:result.ingredients.map(x=>x.trim()).filter(Boolean).slice(0,50),
      steps:result.steps.map(x=>x.trim()).filter(Boolean).slice(0,40),
      notes:result.notes.trim(),
      servings:result.servings.trim(),
      prepTime:result.prepTime.trim(),
      extractedAt:new Date().toISOString(),
      source:"video",
      evidence:media.evidence
    }});
  }catch(error){
    const message=error instanceof Error?error.message:"Could not analyze reel";
    console.error("[reel-video-recipe]",message);
    return NextResponse.json({error:message},{status:500});
  }
}
