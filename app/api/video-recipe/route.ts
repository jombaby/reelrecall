import {NextRequest,NextResponse} from "next/server";

type VideoInput={url:string;title:string;notes:string};
type RecipeResult={available:boolean;title:string;ingredients:string[];steps:string[];notes:string;servings:string;prepTime:string;evidence:string[]};

export async function POST(request:NextRequest){
  if(!process.env.OPENAI_API_KEY)return NextResponse.json({error:"OPENAI_API_KEY is not configured"},{status:503});
  try{
    const body=await request.json() as {video:VideoInput;frames:string[];transcript?:string};
    const frames=(body.frames??[]).filter(x=>typeof x==="string"&&x.startsWith("data:image/")).slice(0,10);
    if(!body.video?.url||frames.length<2)return NextResponse.json({error:"Video frames are required"},{status:400});
    const transcript=(body.transcript??"").trim().slice(0,16000);
    const instruction=`Analyze this cooking video from chronological sampled frames${transcript?" and its narration transcript":""}. Build a recipe only from evidence visible in the frames, on-screen text, saved notes, or transcript. Do not invent quantities, temperatures, cooking times, ingredients, or steps. When an ingredient or action is clearly visible but the amount is not specified, write "amount not specified".\n\nVideo title: ${body.video.title}\nSaved notes: ${body.video.notes||"(none)"}\nNarration transcript: ${transcript||"(not available)"}`;
    const content:Array<Record<string,unknown>>=[{type:"input_text",text:instruction}];
    frames.forEach((image_url,index)=>{content.push({type:"input_text",text:`Frame ${index+1} of ${frames.length}`});content.push({type:"input_image",image_url,detail:"high"})});
    const response=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({model:"gpt-5.6-luna",reasoning:{effort:"none"},max_output_tokens:1600,input:[{role:"user",content}],text:{format:{type:"json_schema",name:"video_recipe",strict:true,schema:{type:"object",additionalProperties:false,properties:{available:{type:"boolean"},title:{type:"string"},ingredients:{type:"array",items:{type:"string"}},steps:{type:"array",items:{type:"string"}},notes:{type:"string"},servings:{type:"string"},prepTime:{type:"string"},evidence:{type:"array",items:{type:"string"}}},required:["available","title","ingredients","steps","notes","servings","prepTime","evidence"]}}}}),signal:AbortSignal.timeout(45000)});
    if(!response.ok){const detail=await response.text();console.error("video-recipe OpenAI error",response.status,detail.slice(0,500));throw new Error("Vision analysis failed")}
    const data=await response.json() as {output?:Array<{content?:Array<{type?:string;text?:string}>}>};
    const text=data.output?.flatMap(item=>item.content??[]).find(item=>item.type==="output_text")?.text;if(!text)throw new Error("No AI result");
    const result=JSON.parse(text) as RecipeResult;
    if(!result.available||!result.ingredients.length||!result.steps.length)return NextResponse.json({recipe:null,message:"AI could not identify both usable ingredients and cooking steps in the sampled video"});
    return NextResponse.json({recipe:{title:result.title.trim()||body.video.title,ingredients:result.ingredients.map(x=>x.trim()).filter(Boolean).slice(0,50),steps:result.steps.map(x=>x.trim()).filter(Boolean).slice(0,40),notes:result.notes.trim(),servings:result.servings.trim(),prepTime:result.prepTime.trim(),extractedAt:new Date().toISOString(),source:"video",evidence:[...new Set([...(result.evidence??[]),transcript?"Spoken narration":"","Video frames / on-screen text"])].filter(Boolean).slice(0,8)}});
  }catch(error){console.error(error);return NextResponse.json({error:"Could not analyze video"},{status:500})}
}
