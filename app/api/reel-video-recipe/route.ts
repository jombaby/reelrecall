import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 300;

// REELRECALL_FACEBOOK_CANONICAL_OCR_V4
type Source = "Instagram" | "Facebook";
type VideoInput = { url: string; title: string; notes: string; source: Source };
type RecipeResult = {
  available:boolean;
  title:string;
  ingredients:string[];
  steps:string[];
  notes:string;
  servings:string;
  prepTime:string;
};
type ActorRow = Record<string, unknown>;

type AnalysisDiagnostics = {
  resolvedFacebookUrl:string;
  directMp4Found:boolean;
  standardFrameCount:number;
  lateSceneFrameCount:number;
  totalOcrFrameCount:number;
  ocrBatchesAttempted:number;
  ocrBatchesWithText:number;
  ocrFramesRetriedIndividually:number;
  ocrRetryFramesWithText:number;
  rawOcrText:string;
  consolidatedOcrText:string;
};

function actorId(value:string){return value.replace("/", "~")}
function asText(value:unknown){return typeof value === "string" ? value.trim() : ""}
function firstText(row:ActorRow, keys:string[]){
  for(const key of keys){
    const value=asText(row[key]);
    if(value)return value;
  }
  return "";
}
function firstUrl(row:ActorRow, keys:string[]){
  for(const key of keys){
    const value=asText(row[key]);
    if(/^https?:\/\//i.test(value))return value;
  }
  return "";
}

// REELRECALL_FACEBOOK_REAL_MP4_FIELD_FIX_V14
function firstMediaUrl(row:ActorRow, keys:string[]){
  for(const key of keys){
    const value=asText(row[key]);
    if(!/^https?:\/\//i.test(value))continue;

    try{
      const u=new URL(value);
      const host=u.hostname.toLowerCase();

      // A facebook.com/fb.watch URL is a page/permalink, not the downloadable
      // video file FrameProbe needs.
      if(
        host==="facebook.com"||
        host.endsWith(".facebook.com")||
        host==="fb.watch"||
        host.endsWith(".fb.watch")
      )continue;

      return value;
    }catch{}
  }
  return "";
}
function rowError(row:ActorRow){
  return firstText(row,["error","errorMessage","message","statusMessage"]);
}

// REELRECALL_FACEBOOK_WORKING_RESOLVER_RESTORED_V6
async function resolveFacebookCanonicalUrl(rawUrl:string){
  try{
    const original=new URL(rawUrl);

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

    const directId=original.pathname.match(/\/reel\/(\d+)/i)?.[1];
    if(directId)return `https://www.facebook.com/reel/${directId}`;

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

    const escapedId=html.match(/facebook\\?\.com\\?\/reel\\?\/(\d+)/i)?.[1];
    if(escapedId)return `https://www.facebook.com/reel/${escapedId}`;

    const plainId=html.match(/facebook\.com\/reel\/(\d+)/i)?.[1];
    if(plainId)return `https://www.facebook.com/reel/${plainId}`;

    return clean(rawUrl);
  }catch{
    return rawUrl;
  }
}

function normalizeOcrText(value:string){
  const lines=value
    .split(/\r?\n/)
    .map(line=>line.replace(/\s+/g," ").trim())
    .filter(Boolean);

  const seen=new Set<string>();
  const unique:string[]=[];

  for(const line of lines){
    const key=line
      .toLowerCase()
      .replace(/[^\p{L}\p{N}¼½¾⅓⅔⅛⅜⅝⅞]+/gu," ")
      .trim();

    if(!key||seen.has(key))continue;
    seen.add(key);
    unique.push(line);
  }

  return unique.join("\n");
}

async function runActor(actor:string,input:unknown,seconds=120){
  const token=process.env.APIFY_TOKEN;
  if(!token)throw new Error("APIFY_TOKEN is not configured in Vercel");

  const endpoint=
    `https://api.apify.com/v2/actors/${actorId(actor)}/run-sync-get-dataset-items?timeout=${seconds}&clean=true&limit=5`;

  let response:Response;

  try{
    response=await fetch(endpoint,{
      method:"POST",
      headers:{
        "Content-Type":"application/json",
        "Authorization":`Bearer ${token}`
      },
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
    try{
      const parsed=JSON.parse(raw) as {error?:{message?:string;type?:string}};
      detail=parsed.error?.message||parsed.error?.type||detail;
    }catch{}
    throw new Error(
      `${actor}: Apify returned ${response.status}${detail?` — ${detail}`:""}`
    );
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


// REELRECALL_FACEBOOK_REAL_FRAME_OCR_V7
type FrameProbeRun = {
  data?:{
    defaultDatasetId?:string;
    defaultKeyValueStoreId?:string;
  }
};

async function sampleVideoFrames(videoUrl:string){
  const token=process.env.APIFY_TOKEN;
  if(!token||!videoUrl)return[] as string[];

  const actor=process.env.APIFY_VIDEO_FRAME_ACTOR||"frameprobe/reel-teardown";

  try{
    const runResponse=await fetch(
      `https://api.apify.com/v2/acts/${actorId(actor)}/runs?waitForFinish=180`,
      {
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "Authorization":`Bearer ${token}`
        },
        body:JSON.stringify({
          videoUrls:[videoUrl],
          maxVideos:1,
          framesPerVideo:12,
          includeOnScreenText:false,
          language:"en"
        }),
        signal:AbortSignal.timeout(195000),
        cache:"no-store"
      }
    );

    if(!runResponse.ok){
      console.warn("[facebook-frame-ocr]",`FrameProbe failed (${runResponse.status})`);
      return[];
    }

    const run=await runResponse.json() as FrameProbeRun;
    const datasetId=run.data?.defaultDatasetId||"";
    const storeId=run.data?.defaultKeyValueStoreId||"";
    if(!datasetId||!storeId)return[];

    const datasetResponse=await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?clean=true&limit=1`,
      {
        headers:{Authorization:`Bearer ${token}`},
        signal:AbortSignal.timeout(15000),
        cache:"no-store"
      }
    );
    if(!datasetResponse.ok)return[];

    const rows=await datasetResponse.json() as ActorRow[];
    const rawKeys=(rows[0]||{})["frameKeys"];
    const frameKeys=Array.isArray(rawKeys)
      ? rawKeys
          .map(value=>typeof value==="string"?value.trim():"")
          .filter(Boolean)
          .slice(0,12)
      : [];

    const frames:string[]=[];

    for(const key of frameKeys){
      try{
        const frameResponse=await fetch(
          `https://api.apify.com/v2/key-value-stores/${storeId}/records/${encodeURIComponent(key)}`,
          {
            headers:{Authorization:`Bearer ${token}`},
            signal:AbortSignal.timeout(15000),
            cache:"no-store"
          }
        );
        if(!frameResponse.ok)continue;

        const contentType=frameResponse.headers.get("content-type")||"image/jpeg";
        const bytes=Buffer.from(await frameResponse.arrayBuffer());
        if(bytes.length>2500000)continue;

        frames.push(`data:${contentType};base64,${bytes.toString("base64")}`);
      }catch{}
    }

    return frames;
  }catch(error){
    console.warn(
      "[facebook-frame-ocr]",
      error instanceof Error?error.message:"frame extraction failed"
    );
    return[];
  }
}


// REELRECALL_LATE_RECIPE_SCENE_SAMPLING_V8
type SceneRecord = {
  startSeconds?:number;
  endSeconds?:number;
  keyframeKey?:string;
};

type SceneSplitterRun = {
  data?:{
    defaultDatasetId?:string;
    defaultKeyValueStoreId?:string;
  }
};

async function sampleLateRecipeSceneFrames(videoUrl:string){
  const token=process.env.APIFY_TOKEN;
  if(!token||!videoUrl)return[] as string[];

  const actor=
    process.env.APIFY_VIDEO_SCENE_ACTOR||
    "frameprobe/video-scene-splitter";

  try{
    const runResponse=await fetch(
      `https://api.apify.com/v2/acts/${actorId(actor)}/runs?waitForFinish=180`,
      {
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          "Authorization":`Bearer ${token}`
        },
        body:JSON.stringify({
          videoUrls:[videoUrl],
          maxVideos:1,
          // Lower than default 0.35 so ingredient-card / overlay changes
          // are more likely to be treated as separate scenes.
          sceneThreshold:0.22
        }),
        signal:AbortSignal.timeout(195000),
        cache:"no-store"
      }
    );

    if(!runResponse.ok){
      console.warn(
        "[facebook-late-scene-ocr]",
        `Scene splitter failed (${runResponse.status})`
      );
      return[];
    }

    const run=await runResponse.json() as SceneSplitterRun;
    const datasetId=run.data?.defaultDatasetId||"";
    const storeId=run.data?.defaultKeyValueStoreId||"";
    if(!datasetId||!storeId)return[];

    const datasetResponse=await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?clean=true&limit=1`,
      {
        headers:{Authorization:`Bearer ${token}`},
        signal:AbortSignal.timeout(15000),
        cache:"no-store"
      }
    );

    if(!datasetResponse.ok)return[];

    const rows=await datasetResponse.json() as ActorRow[];
    const row=rows[0]||{};
    const rawScenes=row["scenes"];

    if(!Array.isArray(rawScenes))return[];

    const scenes=(rawScenes as SceneRecord[])
      .filter(scene=>
        typeof scene.startSeconds==="number" &&
        scene.startSeconds>=8 &&
        typeof scene.keyframeKey==="string" &&
        scene.keyframeKey.trim()
      )
      .sort((a,b)=>(a.startSeconds||0)-(b.startSeconds||0));

    // Recipe reels often introduce ingredients in a sequence after the hook.
    // Keep up to 24 late-scene keyframes in chronological order.
    const selected=scenes.slice(0,24);
    const frames:string[]=[];

    for(const scene of selected){
      const key=scene.keyframeKey?.trim();
      if(!key)continue;

      try{
        const frameResponse=await fetch(
          `https://api.apify.com/v2/key-value-stores/${storeId}/records/${encodeURIComponent(key)}`,
          {
            headers:{Authorization:`Bearer ${token}`},
            signal:AbortSignal.timeout(15000),
            cache:"no-store"
          }
        );

        if(!frameResponse.ok)continue;

        const contentType=
          frameResponse.headers.get("content-type")||
          "image/jpeg";

        const bytes=Buffer.from(await frameResponse.arrayBuffer());
        if(bytes.length>2500000)continue;

        frames.push(
          `data:${contentType};base64,${bytes.toString("base64")}`
        );
      }catch{}
    }

    return frames;
  }catch(error){
    console.warn(
      "[facebook-late-scene-ocr]",
      error instanceof Error?error.message:"late-scene extraction failed"
    );
    return[];
  }
}

async function instagramEvidence(video:VideoInput){
  const actor=
    process.env.APIFY_INSTAGRAM_VIDEO_ACTOR||
    "automation-lab/instagram-reel-ocr-hooks";

  const rows=await runActor(actor,{
    startUrls:[{url:video.url}],
    maxItems:1,
    frameIntervalSeconds:1,
    hookWindowSeconds:12,
    ocrLanguage:"eng+hin",
    includeTranscript:true,
    maxVideoDurationSeconds:180,
    proxyConfiguration:{useApifyProxy:false}
  },180);

  const row=rows[0]||{};
  const actorError=rowError(row);

  const transcript=firstText(row,[
    "transcript",
    "transcriptText",
    "text"
  ]);

  const rawOnScreenText=firstText(row,[
    "onScreenText",
    "hookText",
    "ocrText",
    "screenText",
    "visibleText"
  ]);

  const onScreenText=normalizeOcrText(rawOnScreenText);

  const caption=firstText(row,[
    "caption",
    "description",
    "title"
  ]);

  const thumbnail=firstUrl(row,[
    "thumbnailUrl",
    "displayUrl",
    "imageUrl",
    "thumbnail"
  ]);

  if(!transcript&&!onScreenText&&!caption){
    throw new Error(
      actorError||
      "Instagram reel returned no transcript, caption, or readable on-screen text"
    );
  }

  return{
    caption,
    transcript,
    onScreenText,
    thumbnail,
    frames:[] as string[],
    diagnostics:{
      resolvedFacebookUrl:"",
      directMp4Found:false,
      standardFrameCount:0,
      lateSceneFrameCount:0,
      totalOcrFrameCount:0,
      ocrBatchesAttempted:0,
      ocrBatchesWithText:0,
      ocrFramesRetriedIndividually:0,
      ocrRetryFramesWithText:0,
      rawOcrText:"",
      consolidatedOcrText:""
    } as AnalysisDiagnostics,
    evidence:[
      transcript?"Spoken narration":"",
      onScreenText?"Multilingual on-screen text from sampled reel frames":"",
      caption?"Instagram reel caption":"",
      thumbnail?"Reel preview image":""
    ].filter(Boolean)
  };
}

// REELRECALL_FACEBOOK_MP4_HANDOFF_FIX_V14
async function facebookEvidence(video:VideoInput){
  const resolvedFacebookUrl=await resolveFacebookCanonicalUrl(video.url);
  video={...video,url:resolvedFacebookUrl};

  const errors:string[]=[];
  let caption="",transcript="",thumbnail="",onScreenText="",directVideoUrl="";

  const scraperActor=
    process.env.APIFY_FACEBOOK_VIDEO_ACTOR||
    "apivault_labs/facebook-reels-video-scraper";

  try{
    const rows=await runActor(scraperActor,{
      startUrls:[video.url],
      maxResults:1,
      maxCostUsd:0.10,
      downloadMp4:true,
      includeTranscript:true,
      proxyCountry:"US",
      maxConcurrency:1,
      timeout:90,
      maxRetries:1
    },120);

    const row=rows[0]||{};
    const err=rowError(row);
    if(err)errors.push(`${scraperActor}: ${err}`);

    caption=firstText(row,[
      "caption",
      "description",
      "title"
    ]);

    transcript=firstText(row,[
      "transcript",
      "transcriptText",
      "transcriptSummary"
    ]);

    thumbnail=firstUrl(row,[
      "thumbnailUrl",
      "thumbnail_url",
      "thumbnail",
      "imageUrl"
    ]);

    directVideoUrl=firstMediaUrl(row,[
      // apivault_labs/facebook-reels-video-scraper documents videoMp4Url
      // as the downloadable MP4. videoUrl is the Facebook reel permalink
      // and must NOT be sent to FrameProbe.
      "videoMp4Url",
      "videoMp4UrlHd",
      "videoMp4UrlHD",
      "videoMp4UrlSd",
      "videoMp4UrlSD",
      "video_mp4_url",
      "video_mp4_url_hd",
      "video_mp4_url_sd",
      "video_url_hd",
      "videoUrlHd",
      "videoUrlHD",
      "hdVideoUrl",
      "videoDownloadUrl",
      "videoDownloadLink",
      "downloadUrl",
      "mediaUrl",
      "webVideoUrl",
      "mp4Url",
      "video_url_sd",
      "sdVideoUrl"
    ]);
  }catch(error){
    errors.push(
      error instanceof Error
        ? error.message
        : `${scraperActor}: failed`
    );
  }

  if(!transcript){
    const transcriptActor=
      process.env.APIFY_FACEBOOK_TRANSCRIPT_ACTOR||
      "automation-lab/facebook-video-transcript-extractor";

    try{
      const rows=await runActor(transcriptActor,{
        videoUrls:[video.url],
        maxItems:1,
        language:"auto",
        includeWordTimestamps:false,
        maxVideoDurationSeconds:180
      },150);

      const row=rows[0]||{};
      const err=rowError(row);
      if(err)errors.push(`${transcriptActor}: ${err}`);

      transcript=firstText(row,["transcript","text"]);

      if(!caption){
        caption=firstText(row,["title","description"]);
      }

      if(!thumbnail){
        thumbnail=firstUrl(row,["thumbnailUrl","thumbnail","imageUrl"]);
      }

      if(!directVideoUrl){
        directVideoUrl=firstMediaUrl(row,[
          "videoMp4Url","videoMp4UrlHd","videoMp4UrlHD",
          "videoMp4UrlSd","videoMp4UrlSD",
          "video_mp4_url","video_mp4_url_hd","video_mp4_url_sd",
          "video_url_hd","mediaUrl","webVideoUrl","mp4Url","video_url_sd"
        ]);
      }
    }catch(error){
      errors.push(
        error instanceof Error
          ? error.message
          : `${transcriptActor}: failed`
      );
    }
  }

  const standardFrames=directVideoUrl
    ? await sampleVideoFrames(directVideoUrl)
    : [];

  const lateSceneFrames=directVideoUrl
    ? await sampleLateRecipeSceneFrames(directVideoUrl)
    : [];

  // Keep opening/general coverage plus detailed late ingredient-card scenes.
  // Scene frames are appended chronologically from 8 seconds onward.
  const frames=[
    ...standardFrames,
    ...lateSceneFrames
  ].slice(0,36);

  if(!caption&&!transcript&&!frames.length){
    const detail=errors.filter(Boolean).join(" | ");
    throw new Error(
      detail||
      "Facebook reel returned no public caption, spoken transcript, or video frames"
    );
  }

  return{
    caption,
    transcript,
    onScreenText,
    thumbnail,
    frames,
    diagnostics:{
      resolvedFacebookUrl,
      directMp4Found:Boolean(directVideoUrl),
      standardFrameCount:standardFrames.length,
      lateSceneFrameCount:lateSceneFrames.length,
      totalOcrFrameCount:frames.length,
      ocrBatchesAttempted:0,
      ocrBatchesWithText:0,
      ocrFramesRetriedIndividually:0,
      ocrRetryFramesWithText:0,
      rawOcrText:"",
      consolidatedOcrText:""
    } as AnalysisDiagnostics,
    evidence:[
      transcript?"Spoken narration":"",
      caption?"Facebook reel caption":"",
      thumbnail?"Reel preview image":"",
      directVideoUrl?"Verified direct Facebook MP4":"",
      standardFrames.length?"Standard Facebook video frames for AI OCR":"",
      lateSceneFrames.length?"Late recipe scene keyframes from 8s onward":"",
      frames.length?"Sampled Facebook video frames for AI OCR":""
    ].filter(Boolean)
  };
}


// REELRECALL_DIAGNOSTIC_PIPELINE_V12
// REELRECALL_EVIDENCE_PRESERVING_TWO_PASS_V9
// REELRECALL_COMPLETE_INGREDIENT_OCR_V10
// REELRECALL_OCR_FAILED_BATCH_RECOVERY_V15
type FrameOcrResult = {
  onScreenText:string;
};


async function readSingleFrameTextWithOpenAI(frame:string,frameNumber:number,apiKey:string){
  try{
    const response=await fetch(
      "https://api.openai.com/v1/responses",
      {
        method:"POST",
        headers:{
          Authorization:`Bearer ${apiKey}`,
          "Content-Type":"application/json"
        },
        body:JSON.stringify({
          model:"gpt-5.6-luna",
          reasoning:{effort:"none"},
          max_output_tokens:900,
          input:[
            {
              role:"system",
              content:[
                {
                  type:"input_text",
                  text:
                    "Read this single cooking-video frame meticulously. "+
                    "Return every legible recipe ingredient or measurement visible in the frame. "+
                    "Do not infer missing ingredients. Preserve fractions, units, and English ingredient names exactly. "+
                    "If English text appears with Hindi or another translation beneath it, keep the English ingredient line."
                }
              ]
            },
            {
              role:"user",
              content:[
                {
                  type:"input_text",
                  text:
                    `This is frame ${frameNumber}. Look specifically for ingredient cards, including spices, herbs, seeds, and small quantity text.`
                },
                {
                  type:"input_image",
                  image_url:frame,
                  detail:"high"
                }
              ]
            }
          ],
          text:{
            format:{
              type:"json_schema",
              name:"single_frame_ocr",
              strict:true,
              schema:{
                type:"object",
                additionalProperties:false,
                properties:{
                  onScreenText:{type:"string"}
                },
                required:["onScreenText"]
              }
            }
          }
        }),
        signal:AbortSignal.timeout(50000)
      }
    );

    if(!response.ok){
      console.warn("[frame-ocr-retry]",`Single-frame OCR failed (${response.status})`);
      return"";
    }

    const data=await response.json() as {
      output?:Array<{
        content?:Array<{
          type?:string;
          text?:string;
        }>
      }>
    };

    const outputText=
      data.output
        ?.flatMap(item=>item.content||[])
        .find(item=>item.type==="output_text")
        ?.text;

    if(!outputText)return"";

    const parsed=JSON.parse(outputText) as FrameOcrResult;
    return parsed.onScreenText?.trim()||"";
  }catch(error){
    console.warn(
      "[frame-ocr-retry]",
      error instanceof Error?error.message:"single-frame OCR failed"
    );
    return"";
  }
}

async function readFrameTextWithOpenAI(frames:string[]){
  if(!frames.length){
    return{
      text:"",
      batchesAttempted:0,
      batchesWithText:0,
      framesRetriedIndividually:0,
      retryFramesWithText:0,
      rawText:"",
      consolidatedText:""
    };
  }

  const apiKey=process.env.OPENAI_API_KEY;
  if(!apiKey){
    return{
      text:"",
      batchesAttempted:0,
      batchesWithText:0,
      framesRetriedIndividually:0,
      retryFramesWithText:0,
      rawText:"",
      consolidatedText:""
    };
  }

  const combined:string[]=[];
  let batchesAttempted=0;
  let batchesWithText=0;
  let framesRetriedIndividually=0;
  let retryFramesWithText=0;

  // Keep each vision request small so late ingredient cards do not get
  // drowned out by dozens of images in one multimodal call.
  for(let start=0;start<frames.length;start+=3){
    const batch=frames.slice(start,start+3);
    batchesAttempted+=1;

    const content:Array<Record<string,unknown>>=[
      {
        type:"input_text",
        text:
          `This batch contains frames ${start+1} through ${start+batch.length}. `+
          "Inspect EACH frame separately before combining anything. "+
          "Extract every legible recipe line from every frame, especially ingredient name + quantity. "+
          "Do not stop after finding one ingredient. Do not summarize a group of ingredient cards. "+
          "If consecutive frames show different ingredients, all of those ingredient lines must appear in the output. "+
          "Ingredient cards may show English on one line and Hindi or another translation underneath. "+
          "Preserve the English line independently. Preserve fractions and units such as ½ tbsp, ¼ cup, tsp, tbsp, g, kg, ml, cup. "+
          "Ignore only exact duplicate lines repeated in adjacent frames. Do not invent missing text."
      }
    ];

    for(const frame of batch){
      content.push({
        type:"input_image",
        image_url:frame,
        detail:"high"
      });
    }

    try{
      const response=await fetch(
        "https://api.openai.com/v1/responses",
        {
          method:"POST",
          headers:{
            Authorization:`Bearer ${apiKey}`,
            "Content-Type":"application/json"
          },
          body:JSON.stringify({
            model:"gpt-5.6-luna",
            reasoning:{effort:"none"},
            max_output_tokens:2200,
            input:[
              {
                role:"system",
                content:[
                  {
                    type:"input_text",
                    text:
                      "You are a meticulous frame-by-frame OCR reader for short cooking videos. "+
                      "Your job is completeness, not summarization. "+
                      "Return every distinct legible recipe line actually visible in the supplied frames. "+
                      "A sequence may contain many ingredient cards, one ingredient per frame. "+
                      "Do not infer ingredients from the dish and do not merge different ingredient lines. "+
                      "Do not omit English text because a translation appears below it."
                  }
                ]
              },
              {
                role:"user",
                content
              }
            ],
            text:{
              format:{
                type:"json_schema",
                name:"frame_ocr",
                strict:true,
                schema:{
                  type:"object",
                  additionalProperties:false,
                  properties:{
                    onScreenText:{type:"string"}
                  },
                  required:["onScreenText"]
                }
              }
            }
          }),
          signal:AbortSignal.timeout(50000)
        }
      );

      if(!response.ok){
        console.warn(
          "[frame-ocr]",
          `OpenAI frame OCR failed (${response.status})`
        );
        continue;
      }

      const data=await response.json() as {
        output?:Array<{
          content?:Array<{
            type?:string;
            text?:string;
          }>
        }>
      };

      const outputText=
        data.output
          ?.flatMap(item=>item.content||[])
          .find(item=>item.type==="output_text")
          ?.text;

      if(!outputText){
        for(let i=0;i<batch.length;i++){
          framesRetriedIndividually+=1;
          const recovered=await readSingleFrameTextWithOpenAI(
            batch[i],
            start+i+1,
            apiKey
          );
          if(recovered){
            retryFramesWithText+=1;
            combined.push(recovered);
          }
        }
        continue;
      }

      const parsed=JSON.parse(outputText) as FrameOcrResult;
      if(parsed.onScreenText?.trim()){
        batchesWithText+=1;
        combined.push(parsed.onScreenText.trim());
      }else{
        // If the combined 3-frame request produced no text, do not throw away
        // those frames. Retry each one independently. Small ingredient cards
        // such as paprika, coriander leaves, or sesame seeds can otherwise be
        // lost when a multimodal batch returns an empty OCR result.
        for(let i=0;i<batch.length;i++){
          framesRetriedIndividually+=1;
          const recovered=await readSingleFrameTextWithOpenAI(
            batch[i],
            start+i+1,
            apiKey
          );
          if(recovered){
            retryFramesWithText+=1;
            combined.push(recovered);
          }
        }
      }
    }catch(error){
      console.warn(
        "[frame-ocr]",
        error instanceof Error?error.message:"frame OCR failed"
      );
    }
  }

  const rawCombined=normalizeOcrText(combined.join("\n"));
  if(!rawCombined){
    return{
      text:"",
      batchesAttempted,
      batchesWithText,
      framesRetriedIndividually,
      retryFramesWithText,
      rawText:"",
      consolidatedText:""
    };
  }

  // One text-only cleanup pass removes duplicate translations/repeated frames,
  // but is explicitly forbidden from dropping unique ingredient lines.
  try{
    const response=await fetch(
      "https://api.openai.com/v1/responses",
      {
        method:"POST",
        headers:{
          Authorization:`Bearer ${apiKey}`,
          "Content-Type":"application/json"
        },
        body:JSON.stringify({
          model:"gpt-5.6-luna",
          reasoning:{effort:"none"},
          max_output_tokens:2600,
          input:[
            {
              role:"system",
              content:[
                {
                  type:"input_text",
                  text:
                    "Consolidate OCR text from a cooking reel without losing information. "+
                    "Keep EVERY unique English ingredient line and quantity. "+
                    "Remove only exact/redundant repeats and duplicate translated versions of the same English ingredient. "+
                    "Never shorten the ingredient list. Never summarize multiple ingredients into one line."
                }
              ]
            },
            {
              role:"user",
              content:[
                {
                  type:"input_text",
                  text:
                    "Return the complete deduplicated OCR text. Preserve every unique ingredient and measurement:\n\n"+
                    rawCombined
                }
              ]
            }
          ],
          text:{
            format:{
              type:"json_schema",
              name:"complete_frame_ocr",
              strict:true,
              schema:{
                type:"object",
                additionalProperties:false,
                properties:{
                  onScreenText:{type:"string"}
                },
                required:["onScreenText"]
              }
            }
          }
        }),
        signal:AbortSignal.timeout(50000)
      }
    );

    if(response.ok){
      const data=await response.json() as {
        output?:Array<{
          content?:Array<{
            type?:string;
            text?:string;
          }>
        }>
      };

      const outputText=
        data.output
          ?.flatMap(item=>item.content||[])
          .find(item=>item.type==="output_text")
          ?.text;

      if(outputText){
        const parsed=JSON.parse(outputText) as FrameOcrResult;
        const consolidated=normalizeOcrText(parsed.onScreenText||"");
        if(consolidated){
          return{
            text:consolidated,
            batchesAttempted,
            batchesWithText,
            framesRetriedIndividually,
            retryFramesWithText,
            rawText:rawCombined,
            consolidatedText:consolidated
          };
        }
      }
    }
  }catch(error){
    console.warn(
      "[frame-ocr-consolidation]",
      error instanceof Error?error.message:"OCR consolidation failed"
    );
  }

  return{
    text:rawCombined,
    batchesAttempted,
    batchesWithText,
    framesRetriedIndividually,
    retryFramesWithText,
    rawText:rawCombined,
    consolidatedText:rawCombined
  };
}

export async function POST(request:NextRequest){
  if(!process.env.OPENAI_API_KEY){
    return NextResponse.json(
      {error:"OPENAI_API_KEY is not configured"},
      {status:503}
    );
  }

  if(!process.env.APIFY_TOKEN){
    return NextResponse.json(
      {error:"APIFY_TOKEN is not configured in Vercel. Add it and redeploy."},
      {status:503}
    );
  }

  try{
    const body=await request.json() as {video?:VideoInput};
    const video=body.video;

    if(
      !video?.url||
      !video.title||
      !["Facebook","Instagram"].includes(video.source)
    ){
      return NextResponse.json(
        {error:"A Facebook or Instagram reel is required"},
        {status:400}
      );
    }

    const media=
      video.source==="Instagram"
        ? await instagramEvidence(video)
        : await facebookEvidence(video);

    // First pass: OCR the sampled frames only. This AUGMENTS caption/transcript;
    // it never replaces them.
    const frameOcrResult=
      media.frames?.length
        ? await readFrameTextWithOpenAI(media.frames)
        : {
            text:"",
            batchesAttempted:0,
            batchesWithText:0,
            framesRetriedIndividually:0,
            retryFramesWithText:0,
            rawText:"",
            consolidatedText:""
          };

    media.diagnostics.ocrBatchesAttempted=frameOcrResult.batchesAttempted;
    media.diagnostics.ocrBatchesWithText=frameOcrResult.batchesWithText;
    media.diagnostics.ocrFramesRetriedIndividually=frameOcrResult.framesRetriedIndividually;
    media.diagnostics.ocrRetryFramesWithText=frameOcrResult.retryFramesWithText;
    media.diagnostics.rawOcrText=frameOcrResult.rawText;
    media.diagnostics.consolidatedOcrText=frameOcrResult.consolidatedText;

    const frameOcrText=frameOcrResult.text;

    if(frameOcrText){
      media.onScreenText=normalizeOcrText(
        [media.onScreenText,frameOcrText]
          .filter(Boolean)
          .join("\n")
      );

      if(!media.evidence.includes("Dedicated frame OCR pass")){
        media.evidence.push("Dedicated frame OCR pass");
      }
      if(!media.evidence.includes("Complete ingredient OCR v10")){
        media.evidence.push("Complete ingredient OCR v10");
      }
    }

    const evidenceText=[
      video.notes
        ? `Saved notes:\n${video.notes}`
        : "",
      media.caption
        ? `Reel caption:\n${media.caption}`
        : "",
      media.transcript
        ? `Spoken narration transcript:\n${media.transcript}`
        : "",
      media.onScreenText
        ? `Text read from sampled video frames:\n${media.onScreenText}`
        : ""
    ]
      .filter(Boolean)
      .join("\n\n")
      .slice(0,28000);

    if(!evidenceText.trim()){
      return NextResponse.json({
        recipe:null,
        message:
          "The reel was retrieved, but it did not expose enough caption, narration, or on-screen text for recipe analysis."
      });
    }

    const content:Array<Record<string,unknown>>=[
      {
        type:"input_text",
        text:JSON.stringify({
          source:video.source,
          title:video.title,
          url:video.url,
          extractedEvidence:evidenceText
        })
      }
    ];

    if(media.thumbnail){
      content.push({
        type:"input_image",
        image_url:media.thumbnail,
        detail:"high"
      });
    }


    const response=await fetch(
      "https://api.openai.com/v1/responses",
      {
        method:"POST",
        headers:{
          Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type":"application/json"
        },
        body:JSON.stringify({
          model:"gpt-5.6-luna",
          reasoning:{effort:"none"},
          max_output_tokens:1800,
          input:[
            {
              role:"system",
              content:[
                {
                  type:"input_text",
                  text:
                    "Create a cooking recipe only from evidence extracted from the selected reel: narration, on-screen text/OCR, caption, and preview image. "+
                    "Do not invent exact quantities, temperatures, cooking times, or ingredients. "+
                    "If an ingredient or action is clear but its amount is absent, use 'amount not specified'. "+
                    "Preserve the sequence of preparation steps. "+
                    "Multilingual recipe reels often show an English ingredient or measurement on one line and a Hindi or other-language translation directly underneath it. "+
                    "Treat every visible line independently. Never discard or ignore an English ingredient line merely because a translated line follows it. "+
                    "Preserve Unicode fractions and measurements exactly when evidence supports them, including ¼, ½, ¾, tsp, tbsp, cup, g, kg, ml and l. "+
                    "When English and a translation describe the same ingredient, prefer the English ingredient/measurement text for the normalized ingredient list rather than counting them as two different ingredients. "+
                    "OCR evidence can be more important than narration for recipe quantities. "+
                    "The supplied extractedEvidence already contains the original reel caption, spoken transcript, and a dedicated OCR pass over sampled video frames. "+
                    "Use ALL three evidence sources together. Never discard caption or spoken-transcript information merely because OCR text is present. "+
                    "Ingredient cards may begin late in the reel, so accumulate every ingredient and measurement found in the OCR text across consecutive cards. "+
                    "Every distinct ingredient line present in the dedicated OCR text must be represented in the final ingredients array unless it is clearly not an ingredient. Do not shorten a long ingredient list merely to make the recipe concise. "+
                    "For bilingual OCR, preserve the English ingredient/measurement line independently even when Hindi or another translation appears beneath it. "+
                    "Set available=false only when the combined caption, narration and OCR evidence is genuinely insufficient to produce a useful recipe with at least one ingredient and one preparation or cooking step."
                }
              ]
            },
            {
              role:"user",
              content
            }
          ],
          text:{
            format:{
              type:"json_schema",
              name:"reel_recipe_analysis",
              strict:true,
              schema:{
                type:"object",
                additionalProperties:false,
                properties:{
                  available:{type:"boolean"},
                  title:{type:"string"},
                  ingredients:{
                    type:"array",
                    items:{type:"string"}
                  },
                  steps:{
                    type:"array",
                    items:{type:"string"}
                  },
                  notes:{type:"string"},
                  servings:{type:"string"},
                  prepTime:{type:"string"}
                },
                required:[
                  "available",
                  "title",
                  "ingredients",
                  "steps",
                  "notes",
                  "servings",
                  "prepTime"
                ]
              }
            }
          }
        }),
        signal:AbortSignal.timeout(50000)
      }
    );

    if(!response.ok){
      const raw=await response.text();
      throw new Error(
        `AI recipe analysis failed (${response.status})${raw?` — ${raw.slice(0,300)}`:""}`
      );
    }

    const data=await response.json() as {
      output?:Array<{
        content?:Array<{
          type?:string;
          text?:string
        }>
      }>
    };

    const outputText=
      data.output
        ?.flatMap(item=>item.content||[])
        .find(item=>item.type==="output_text")
        ?.text;

    if(!outputText){
      throw new Error("AI returned no recipe result");
    }

    const result=JSON.parse(outputText) as RecipeResult;


    if(
      !result.available||
      !result.ingredients.length||
      !result.steps.length
    ){
      return NextResponse.json({
        recipe:null,
        message:
          media.onScreenText
            ? "AI combined caption, transcript, and dedicated frame OCR but still could not identify enough reliable recipe detail."
            : media.evidence.includes("Late recipe scene keyframes from 8s onward")
              ? "AI inspected late recipe scenes but could not identify enough reliable recipe detail."
              : "AI analyzed the reel evidence but could not identify enough reliable recipe detail.",
        analysis:{
          caption:media.caption,
          transcript:media.transcript,
          onScreenText:media.onScreenText,
          evidence:media.evidence,
          diagnostics:media.diagnostics
        }
      });
    }

    return NextResponse.json({
      recipe:{
        title:result.title.trim()||video.title,
        ingredients:result.ingredients
          .map(x=>x.trim())
          .filter(Boolean)
          .slice(0,50),
        steps:result.steps
          .map(x=>x.trim())
          .filter(Boolean)
          .slice(0,40),
        notes:result.notes.trim(),
        servings:result.servings.trim(),
        prepTime:result.prepTime.trim(),
        extractedAt:new Date().toISOString(),
        source:"video",
        evidence:media.evidence
      },
      analysis:{
        caption:media.caption,
        transcript:media.transcript,
        onScreenText:media.onScreenText,
        evidence:media.evidence,
        diagnostics:media.diagnostics
      }
    });
  }catch(error){
    const message=
      error instanceof Error
        ? error.message
        : "Could not analyze reel";

    console.error(
      "[reel-video-recipe]",
      message
    );

    return NextResponse.json(
      {error:message},
      {status:500}
    );
  }
}
