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
function rowError(row:ActorRow){
  return firstText(row,["error","errorMessage","message","statusMessage"]);
}

// REELRECALL_FACEBOOK_SHARE_RESOLVER_V5
function canonicalizeFacebookUrl(input:string){
  const raw=String(input||"").trim();
  if(!raw)return raw;

  try{
    const url=new URL(raw);
    const cleanSearch=new URLSearchParams(url.search);

    for(const key of [
      "mibextid","wa_status_inline","igsh","share_url","sfnsn","rdid"
    ]){
      cleanSearch.delete(key);
    }

    const path=url.pathname.replace(/\/+/g,"/");

    const reelMatch=path.match(/\/reels?\/([A-Za-z0-9._-]+)/i);
    if(reelMatch?.[1]){
      return `https://www.facebook.com/reel/${reelMatch[1]}`;
    }

    const videoMatch=path.match(/\/videos\/([0-9]+)/i);
    if(videoMatch?.[1]){
      return `https://www.facebook.com/watch/?v=${videoMatch[1]}`;
    }

    const watchId=url.searchParams.get("v");
    if(watchId && /^[0-9]+$/.test(watchId)){
      return `https://www.facebook.com/watch/?v=${watchId}`;
    }

    url.protocol="https:";
    url.hostname="www.facebook.com";
    url.search=cleanSearch.toString();
    url.hash="";
    return url.toString().replace(/\?$/,"").replace(/\/$/,"");
  }catch{
    return raw;
  }
}

async function resolveFacebookUrl(input:string){
  const original=canonicalizeFacebookUrl(input);

  if(
    /facebook\.com\/reel\/[^/?#]+/i.test(original)||
    /facebook\.com\/watch\/?\?v=\d+/i.test(original)
  ){
    return original;
  }

  if(!/facebook\.com\/share\/r\//i.test(original)){
    return original;
  }

  const candidates=[
    original,
    original.replace("www.facebook.com","m.facebook.com")
  ];

  for(const candidate of candidates){
    try{
      const response=await fetch(candidate,{
        method:"GET",
        redirect:"follow",
        cache:"no-store",
        headers:{
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "+
            "AppleWebKit/537.36 (KHTML, like Gecko) "+
            "Chrome/152.0.0.0 Safari/537.36",
          "Accept":
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language":"en-US,en;q=0.9"
        },
        signal:AbortSignal.timeout(15000)
      });

      const finalUrl=canonicalizeFacebookUrl(response.url||candidate);

      if(
        /facebook\.com\/reel\/[^/?#]+/i.test(finalUrl)||
        /facebook\.com\/watch\/?\?v=\d+/i.test(finalUrl)
      ){
        return finalUrl;
      }

      const html=(await response.text()).slice(0,1500000);

      // REELRECALL_FACEBOOK_SHARE_REGEX_FIX_V5_1
      // Use RegExp strings rather than regex literals because Facebook HTML
      // can contain JSON-escaped URLs such as https:\/\/...
      const reelEscaped=html.match(
        new RegExp(
          String.raw`https:\\/\\/www\.facebook\.com\\/reel\\/([A-Za-z0-9._-]+)`,
          "i"
        )
      );
      if(reelEscaped?.[1]){
        return `https://www.facebook.com/reel/${reelEscaped[1]}`;
      }

      const reelPlain=html.match(
        new RegExp(
          String.raw`https://www\.facebook\.com/reel/([A-Za-z0-9._-]+)`,
          "i"
        )
      );
      if(reelPlain?.[1]){
        return `https://www.facebook.com/reel/${reelPlain[1]}`;
      }

      const videoId=
        html.match(/"video_id":"(\d+)"/i)?.[1]||
        html.match(/"videoID":"(\d+)"/i)?.[1]||
        html.match(/"videoId":"(\d+)"/i)?.[1];

      if(videoId){
        return `https://www.facebook.com/watch/?v=${videoId}`;
      }
    }catch(error){
      console.warn(
        "[facebook-share-resolver]",
        candidate,
        error instanceof Error?error.message:"resolution failed"
      );
    }
  }

  return original;
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
    evidence:[
      transcript?"Spoken narration":"",
      onScreenText?"Multilingual on-screen text from sampled reel frames":"",
      caption?"Instagram reel caption":"",
      thumbnail?"Reel preview image":""
    ].filter(Boolean)
  };
}

async function facebookEvidence(video:VideoInput){
  const errors:string[]=[];
  let caption="",transcript="",thumbnail="",onScreenText="";

  const canonicalUrl=await resolveFacebookUrl(video.url);
  const facebookUrlCandidates=[
    canonicalUrl,
    canonicalizeFacebookUrl(video.url),
    video.url
  ].filter((value,index,array)=>value&&array.indexOf(value)===index);

  const scraperActor=
    process.env.APIFY_FACEBOOK_VIDEO_ACTOR||
    "apivault_labs/facebook-reels-video-scraper";

  try{
    let rows:ActorRow[]=[];
    let scraperLastError="";

    for(const candidateUrl of facebookUrlCandidates){
      try{
        rows=await runActor(scraperActor,{
      startUrls:[candidateUrl],
      maxResults:1,
      maxCostUsd:0.10,
      downloadMp4:true,
      includeTranscript:true,
      includeText:true,
      includeOcr:true,
      ocrLanguage:"eng+hin",
      proxyCountry:"US",
      maxConcurrency:1,
      timeout:90,
      maxRetries:1
    },120);
        if(rows.length)break;
      }catch(error){
        scraperLastError=
          error instanceof Error?error.message:`${scraperActor}: failed`;
      }
    }

    if(!rows.length&&scraperLastError){
      throw new Error(scraperLastError);
    }

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
      "thumbnail",
      "imageUrl"
    ]);

    onScreenText=normalizeOcrText(
      firstText(row,[
        "onScreenText",
        "ocrText",
        "hookText",
        "screenText",
        "visibleText"
      ])
    );
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
      let rows:ActorRow[]=[];
      let transcriptLastError="";

      for(const candidateUrl of facebookUrlCandidates){
        try{
          rows=await runActor(transcriptActor,{
        videoUrls:[candidateUrl],
        maxItems:1,
        language:"auto",
        includeWordTimestamps:false,
        maxVideoDurationSeconds:180
      },150);
          if(rows.length)break;
        }catch(error){
          transcriptLastError=
            error instanceof Error?error.message:`${transcriptActor}: failed`;
        }
      }

      if(!rows.length&&transcriptLastError){
        throw new Error(transcriptLastError);
      }

      const row=rows[0]||{};
      const err=rowError(row);
      if(err)errors.push(`${transcriptActor}: ${err}`);

      transcript=firstText(row,[
        "transcript",
        "text"
      ]);

      if(!caption){
        caption=firstText(row,[
          "title",
          "description"
        ]);
      }

      if(!thumbnail){
        thumbnail=firstUrl(row,[
          "thumbnailUrl",
          "thumbnail",
          "imageUrl"
        ]);
      }

      if(!onScreenText){
        onScreenText=normalizeOcrText(
          firstText(row,[
            "onScreenText",
            "ocrText",
            "screenText",
            "visibleText"
          ])
        );
      }
    }catch(error){
      errors.push(
        error instanceof Error
          ? error.message
          : `${transcriptActor}: failed`
      );
    }
  }

  if(!caption&&!transcript&&!onScreenText){
    const detail=errors.filter(Boolean).join(" | ");
    throw new Error(
      detail||
      "Facebook reel returned no public caption, spoken transcript, or readable on-screen text"
    );
  }

  return{
    caption,
    transcript,
    onScreenText,
    thumbnail,
    evidence:[
      transcript?"Spoken narration":"",
      onScreenText?"Multilingual on-screen text":"",
      caption?"Facebook reel caption":"",
      thumbnail?"Reel preview image":"",
      canonicalUrl!==video.url?"Resolved/canonical Facebook URL":""
    ].filter(Boolean)
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
            ? "AI read on-screen recipe text but still could not identify enough reliable recipe detail."
            : "AI analyzed the reel evidence but could not identify enough reliable recipe detail.",
        analysis:{
          caption:media.caption,
          transcript:media.transcript,
          onScreenText:media.onScreenText,
          evidence:media.evidence
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
        evidence:media.evidence
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
