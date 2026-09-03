import { NextRequest,NextResponse } from "next/server";
import { publicDescription,SocialVideoInput } from "@/lib/social-description";

type RecipeResult={available:boolean;title:string;ingredients:string[];steps:string[];notes:string;servings:string;prepTime:string};

export async function POST(request:NextRequest){
  if(!process.env.OPENAI_API_KEY)return NextResponse.json({error:"OPENAI_API_KEY is not configured"},{status:503});
  try{
    const body=await request.json() as {video:SocialVideoInput;description?:string};
    if(!body.video?.url)throw new Error("Invalid request");

    const supplied=(body.description??"").trim();
    const publicText=supplied?"":await publicDescription(body.video);
    const evidence=[body.video.notes,supplied,publicText].filter(Boolean).join("\n\n").trim();
    const isFacebook=/facebook\.com|fb\.watch/i.test(body.video.url);

    if(!evidence)return NextResponse.json({recipe:null,descriptionFound:false,facebookBlocked:isFacebook});

    const apiResponse=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},
      body:JSON.stringify({
        model:"gpt-5.6-luna",
        reasoning:{effort:"none"},
        max_output_tokens:1400,
        input:[
          {role:"system",content:[{type:"input_text",text:"Extract a cooking recipe only from the supplied evidence. Never invent ingredients, quantities, temperatures, timing, servings, or steps not present in the evidence. Set available=true when there is at least one usable ingredient and at least one cooking or preparation step. Preserve quantities, temperatures, timings, ingredient names and ordered steps. A social-media caption can be informal; infer structure but not missing facts. If the evidence is not actually a recipe or is too incomplete, set available=false."}]},
          {role:"user",content:[{type:"input_text",text:JSON.stringify({video_title:body.video.title,saved_notes:body.video.notes,description:supplied||publicText})}]}
        ],
        text:{format:{type:"json_schema",name:"recipe_extraction",strict:true,schema:{
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
      signal:AbortSignal.timeout(30000)
    });

    if(!apiResponse.ok)throw new Error("Recipe extraction failed");
    const data=await apiResponse.json() as {output?:Array<{content?:Array<{type?:string;text?:string}>}>};
    const text=data.output?.flatMap(item=>item.content??[]).find(item=>item.type==="output_text")?.text;
    if(!text)throw new Error("No recipe result");

    const result=JSON.parse(text) as RecipeResult;
    if(!result.available||!result.ingredients.length||!result.steps.length){
      return NextResponse.json({recipe:null,descriptionFound:true,facebookBlocked:isFacebook&&!supplied});
    }

    return NextResponse.json({
      recipe:{
        title:result.title.trim()||body.video.title,
        ingredients:result.ingredients.map(x=>x.trim()).filter(Boolean).slice(0,50),
        steps:result.steps.map(x=>x.trim()).filter(Boolean).slice(0,40),
        notes:result.notes.trim(),
        servings:result.servings.trim(),
        prepTime:result.prepTime.trim(),
        extractedAt:new Date().toISOString()
      },
      descriptionFound:true,
      facebookBlocked:false
    });
  }catch{
    return NextResponse.json({error:"Could not extract recipe"},{status:500});
  }
}
