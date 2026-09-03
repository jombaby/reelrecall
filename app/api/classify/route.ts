import { NextRequest,NextResponse } from "next/server";

type Category={name:string;subcategories:string[]};
type InputVideo={url:string;title:string;notes:string};

function decode(value:string){return value.replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim()}
async function publicDescription(video:InputVideo){
  try{
    const target=new URL(video.url),allowed=["instagram.com","www.instagram.com","facebook.com","www.facebook.com","fb.watch","youtube.com","www.youtube.com","youtu.be"];
    if(!allowed.includes(target.hostname))return"";
    if(target.hostname.includes("youtu")){
      const endpoint=`https://www.youtube.com/oembed?url=${encodeURIComponent(video.url)}&format=json`,response=await fetch(endpoint,{signal:AbortSignal.timeout(7000)});
      if(response.ok){const data=await response.json() as {title?:string;author_name?:string};return[data.title,data.author_name].filter(Boolean).join(" — ")}
    }
    const response=await fetch(target,{redirect:"follow",signal:AbortSignal.timeout(7000),headers:{"User-Agent":"Mozilla/5.0 (compatible; ReelRecall/1.0)","Accept-Language":"en-US,en;q=0.9"}});
    if(!response.ok)return"";const html=await response.text();
    const description=html.match(/<meta[^>]+(?:property|name)=["'](?:og:description|description)["'][^>]+content=["']([^"']+)["']/i)?.[1]??html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:description|description)["']/i)?.[1]??"";
    return decode(description).slice(0,4000)
  }catch{return""}
}

export async function POST(request:NextRequest){
  if(!process.env.OPENAI_API_KEY)return NextResponse.json({error:"OPENAI_API_KEY is not configured"},{status:503});
  try{
    const body=await request.json() as {video:InputVideo;categories:Category[]};
    if(!body.video?.url||!Array.isArray(body.categories))throw new Error("Invalid request");
    const categories=body.categories.map(c=>({name:c.name,subcategories:c.subcategories})),description=await publicDescription(body.video);
    const apiResponse=await fetch("https://api.openai.com/v1/responses",{method:"POST",headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},body:JSON.stringify({
      model:"gpt-5.6-luna",reasoning:{effort:"none"},max_output_tokens:300,
      input:[{role:"system",content:[{type:"input_text",text:"Organize a saved social video using only the supplied evidence. Create a specific, natural title of 2-9 words describing the actual content, such as Healthy Egg Roll, Chicken Tikka Masala, or Elegant White and Brown Formal Dress. Never use a platform name, the words video or reel, a date/time, or a sender name as the title. Do not invent details unsupported by the title, note, or public description. Select exactly one existing category and one of that category's subcategories, or an empty subcategory. Create 3-6 concise lowercase tags. Never invent a new category. If category evidence is weak, use Uncategorized and factual tags."}]},{role:"user",content:[{type:"input_text",text:JSON.stringify({available_categories:categories,current_title:body.video.title,whatsapp_note:body.video.notes,public_description:description})}]}],
      text:{format:{type:"json_schema",name:"video_classification",strict:true,schema:{type:"object",additionalProperties:false,properties:{title:{type:"string"},description:{type:"string"},category:{type:"string"},subcategory:{type:"string"},tags:{type:"array",items:{type:"string"}}},required:["title","description","category","subcategory","tags"]}}}
    }),signal:AbortSignal.timeout(25000)});
    if(!apiResponse.ok)throw new Error("Classification failed");
    const data=await apiResponse.json() as {output?:Array<{content?:Array<{type?:string;text?:string}>}>};
    const text=data.output?.flatMap(item=>item.content??[]).find(item=>item.type==="output_text")?.text;if(!text)throw new Error("No classification");
    const result=JSON.parse(text) as {title:string;description:string;category:string;subcategory:string;tags:string[]};
    const selected=categories.find(c=>c.name===result.category)??categories.find(c=>c.name==="Uncategorized");if(!selected)throw new Error("No fallback category");
    return NextResponse.json({...result,category:selected.name,subcategory:selected.subcategories.includes(result.subcategory)?result.subcategory:"",tags:result.tags.map(t=>t.trim().toLowerCase()).filter(Boolean).slice(0,6)})
  }catch{return NextResponse.json({error:"Could not classify video"},{status:500})}
}
