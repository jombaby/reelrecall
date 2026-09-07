import { NextRequest,NextResponse } from "next/server";
import { publicDescription,SocialVideoInput } from "@/lib/social-description";

type RecipeResult={available:boolean;title:string;ingredients:string[];steps:string[];notes:string;servings:string;prepTime:string};
type RecipeMode="standard"|"max";

function cleanRecipeEvidence(value:string){
  return value
    .replace(/\[\s*\*\*([^\]]+?)\*\*\s*\]\([^\s)]+(?:\([^)]*\)[^)]*)?\)/g,"$1")
    .replace(/\[([^\]]+?)\]\(https?:\/\/[^)]+\)/g,"$1")
    .replace(/https?:\/\/www\.facebook\.com\/reel\/hashtag\/?[^\s)]+/gi," ")
    .replace(/\bSee\s+(?:less|more)\b/gi," ")
    .replace(/[ \t]+/g," ")
    .replace(/\n[ \t]+/g,"\n")
    .replace(/\n{3,}/g,"\n\n")
    .trim()
    .slice(0,16000);
}

function cleanLines(values:string[],limit:number){
  return values.map(x=>x.trim()).filter(Boolean).slice(0,limit);
}

export async function POST(request:NextRequest){
  if(!process.env.OPENAI_API_KEY)return NextResponse.json({error:"OPENAI_API_KEY is not configured"},{status:503});

  try{
    const body=await request.json() as {video:SocialVideoInput;description?:string;mode?:RecipeMode};
    if(!body.video?.url)throw new Error("Invalid request");

    const mode:RecipeMode=body.mode==="max"?"max":"standard";
    const supplied=(body.description??"").trim();
    const publicText=supplied?"":await publicDescription(body.video);
    const evidence=cleanRecipeEvidence([body.video.notes,supplied,publicText].filter(Boolean).join("\n\n"));
    const isFacebook=/facebook\.com|fb\.watch/i.test(body.video.url);

    if(!evidence){
      return NextResponse.json({recipe:null,descriptionFound:false,facebookBlocked:isFacebook,message:"No usable public description was available."});
    }

    const maxDetailInstruction=mode==="max"
      ? "Extract the maximum reliable recipe detail present in the description. Carefully scan the entire evidence for a recipe title, every ingredient and quantity, servings, prep/cooking time, preparation actions, cooking steps, temperatures, timings, and useful notes. Social captions may place all ingredients in one paragraph without bullets. Split them into individual ingredient lines when the boundaries are clear. Do not omit ingredients merely because cooking steps are absent. "
      : "Extract all reliable recipe detail present in the description. ";

    const apiResponse=await fetch("https://api.openai.com/v1/responses",{
      method:"POST",
      headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},
      body:JSON.stringify({
        model:"gpt-5.6-luna",
        reasoning:{effort:"none"},
        max_output_tokens:mode==="max"?2200:1600,
        input:[
          {
            role:"system",
            content:[{
              type:"input_text",
              text:
                "Extract a cooking recipe only from the supplied evidence. "+
                maxDetailInstruction+
                "Never invent ingredients, quantities, temperatures, timing, servings, or cooking steps that are not stated or strongly explicit in the evidence. "+
                "Set available=true when the evidence contains at least one credible recipe ingredient OR at least one credible preparation/cooking step. "+
                "An ingredient-only description is a valid PARTIAL recipe: return all reliable ingredients, leave steps as an empty array, and do not fabricate steps. "+
                "A steps-only description can also be a partial recipe: return the supported steps and leave ingredients empty. "+
                "When a quantity is absent, preserve the ingredient without inventing an amount. "+
                "Preserve Unicode fractions and stated units. Preserve useful title, servings, prep/cooking time and notes when supported. "+
                "Ignore social-media hashtag/link boilerplate and 'See less/See more' text. "+
                "Set available=false only when the evidence contains neither a credible recipe ingredient nor a credible cooking/preparation instruction."
            }]
          },
          {
            role:"user",
            content:[{
              type:"input_text",
              text:JSON.stringify({video_title:body.video.title,description:evidence,extraction_mode:mode})
            }]
          }
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
      signal:AbortSignal.timeout(mode==="max"?45000:30000)
    });

    if(!apiResponse.ok){
      const raw=await apiResponse.text();
      throw new Error(`Recipe extraction failed (${apiResponse.status})${raw?` — ${raw.slice(0,250)}`:""}`);
    }

    const data=await apiResponse.json() as {output?:Array<{content?:Array<{type?:string;text?:string}>}>};
    const text=data.output?.flatMap(item=>item.content??[]).find(item=>item.type==="output_text")?.text;
    if(!text)throw new Error("No recipe result");

    const result=JSON.parse(text) as RecipeResult;
    const ingredients=cleanLines(result.ingredients??[],60);
    const steps=cleanLines(result.steps??[],50);

    if(!result.available||(!ingredients.length&&!steps.length)){
      return NextResponse.json({
        recipe:null,
        descriptionFound:true,
        facebookBlocked:isFacebook&&!supplied,
        partial:false,
        missing:["ingredients","steps"],
        message:"The description was found, but it did not contain a reliable recipe ingredient or preparation step."
      });
    }

    const missing:string[]=[];
    if(!ingredients.length)missing.push("ingredients");
    if(!steps.length)missing.push("steps");
    const partial=missing.length>0;

    let notes=result.notes.trim();
    if(partial&&missing.includes("steps")&&!/steps? (?:were|are) (?:not|unavailable)|steps? missing/i.test(notes)){
      notes=[notes,"Cooking steps were not stated in the available description."].filter(Boolean).join(" ");
    }
    if(partial&&missing.includes("ingredients")&&!/ingredients? (?:were|are) (?:not|unavailable)|ingredients? missing/i.test(notes)){
      notes=[notes,"Ingredients were not stated in the available description."].filter(Boolean).join(" ");
    }

    return NextResponse.json({
      recipe:{
        title:result.title.trim()||body.video.title,
        ingredients,
        steps,
        notes,
        servings:result.servings.trim(),
        prepTime:result.prepTime.trim(),
        extractedAt:new Date().toISOString(),
        source:"description",
        evidence:[mode==="max"?"Maximum-detail description extraction":"Public/saved description"]
      },
      descriptionFound:true,
      facebookBlocked:false,
      partial,
      missing,
      message:partial?`Partial recipe recovered; missing ${missing.join(" and ")}.`:"Recipe recovered from description."
    });
  }catch(error){
    const message=error instanceof Error?error.message:"Could not extract recipe";
    console.error("[recipe-description]",message);
    return NextResponse.json({error:message,message},{status:500});
  }
}
