import { NextRequest,NextResponse } from "next/server";
import { publicDescription,SocialVideoInput } from "@/lib/social-description";

type RecipeResult={available:boolean;title:string;ingredients:string[];steps:string[];notes:string;servings:string;prepTime:string};

export async function POST(request:NextRequest){
  if(!process.env.OPENAI_API_KEY)return NextResponse.json({error:"OPENAI_API_KEY is not configured"},{status:503});
  try{
    const body=await request.json() as {video:SocialVideoInput};
    if(!body.video?.url)throw new Error("Invalid request");
    const description=await publicDescription(body.video);
    const evidence=[body.video.notes,description].filter(Boolean).join("\n\n").trim();
    if(!evidence)return NextResponse.json({recipe:null,descriptionFound:false});

    const apiResponse=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({
      model:"gpt-5.6-luna",reasoning:{effort:"none"},max_output_tokens:1200,
      input:[
        {role:"system",content:[{type:"input_text",text:"Extract a cooking recipe only from the supplied evidence. Never invent ingredients, quantities, temperatures, timing, servings, or steps that are not stated or strongly explicit in the evidence. Set available=true only when the evidence contains at least one usable ingredient and at least one cooking or preparation step. Preserve useful quantities and temperatures. Keep each ingredient and step concise. If the evidence is not a recipe or is too incomplete, set available=false and return empty strings and arrays."}]},
        {role:"user",content:[{type:"input_text",text:JSON.stringify({video_title:body.video.title,saved_notes:body.video.notes,public_description:description})}]}
      ],
      text:{format:{type:"json_schema",name:"recipe_extraction",strict:true,schema:{type:"object",additionalProperties:false,properties:{available:{type:"boolean"},title:{type:"string"},ingredients:{type:"array",items:{type:"string"}},steps:{type:"array",items:{type:"string"}},notes:{type:"string"},servings:{type:"string"},prepTime:{type:"string"}},required:["available","title","ingredients","steps","notes","servings","prepTime"]}}}
    }),signal:AbortSignal.timeout(30000)});

    if(!apiResponse.ok)throw new Error("Recipe extraction failed");
    const data=await apiResponse.json() as {output?:Array<{content?:Array<{type?:string;text?:string}>}>};
    const text=data.output?.flatMap(item=>item.content??[]).find(item=>item.type==="output_text")?.text;
    if(!text)throw new Error("No recipe result");
    const result=JSON.parse(text) as RecipeResult;

    if(!result.available||!result.ingredients.length||!result.steps.length)return NextResponse.json({recipe:null,descriptionFound:true});

    return NextResponse.json({recipe:{
      title:result.title.trim()||body.video.title,
      ingredients:result.ingredients.map(x=>x.trim()).filter(Boolean).slice(0,40),
      steps:result.steps.map(x=>x.trim()).filter(Boolean).slice(0,30),
      notes:result.notes.trim(),
      servings:result.servings.trim(),
      prepTime:result.prepTime.trim(),
      extractedAt:new Date().toISOString()
    },descriptionFound:true});
  }catch{
    return NextResponse.json({error:"Could not extract recipe"},{status:500});
  }
}
