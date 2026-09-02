import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";

type Suggestion = { id:string; category:string; subcategory:string; tags:string[] };

function responseText(payload: { output?: Array<{ content?: Array<{ type?:string; text?:string }> }> }) {
  for (const item of payload.output || []) for (const content of item.content || []) if (content.type === "output_text" && content.text) return content.text;
  return "";
}

export async function POST(request: Request) {
  if (!(await requireOwner())) return NextResponse.json({ error:"Unauthorized" }, { status:401 });
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error:"OPENAI_API_KEY is not configured in Vercel" }, { status:503 });
  const body = await request.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.ids) ? body.ids.slice(0,50) : [];
  const reels = ids.length
    ? await db()`SELECT id,title,notes,category,subcategory,tags,category_manual,tags_manual FROM reels WHERE owner_id='owner' AND id=ANY(${ids}::uuid[]) AND (NOT category_manual OR NOT tags_manual)`
    : await db()`SELECT id,title,notes,category,subcategory,tags,category_manual,tags_manual FROM reels WHERE owner_id='owner' AND unavailable=false AND (NOT category_manual OR NOT tags_manual) ORDER BY added_at DESC LIMIT 50`;
  if (!reels.length) return NextResponse.json({ updated:0 });
  const categories = await db()`SELECT c.name,p.name AS parent_name FROM categories c LEFT JOIN categories p ON p.id=c.parent_id WHERE c.owner_id='owner' ORDER BY p.name NULLS FIRST,c.name`;
  const taxonomy = categories.map(c => c.parent_name ? `${c.parent_name} > ${c.name}` : c.name).join("\n");
  const input = reels.map(r => ({ id:r.id,title:r.title,description:r.notes || "" }));
  const aiResponse = await fetch("https://api.openai.com/v1/responses", { method:"POST", headers:{"Authorization":`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"}, body:JSON.stringify({
    model:process.env.OPENAI_MODEL || "gpt-4o-mini", store:false,
    input:[
      {role:"developer",content:`Categorize saved social-media reels. Choose the closest existing top-level category and optional subcategory from this taxonomy:\n${taxonomy}\nUse Other only when nothing fits. Produce 2-6 short lowercase tags. Do not invent facts not supported by the title or description.`},
      {role:"user",content:JSON.stringify(input)}
    ],
    text:{format:{type:"json_schema",name:"reel_categories",strict:true,schema:{type:"object",properties:{items:{type:"array",items:{type:"object",properties:{id:{type:"string"},category:{type:"string"},subcategory:{type:"string"},tags:{type:"array",items:{type:"string"}}},required:["id","category","subcategory","tags"],additionalProperties:false}}},required:["items"],additionalProperties:false}}}
  })});
  if (!aiResponse.ok) { const detail=await aiResponse.text(); return NextResponse.json({error:`OpenAI categorization failed: ${detail.slice(0,180)}`},{status:502}); }
  const parsed = JSON.parse(responseText(await aiResponse.json())) as { items:Suggestion[] };
  let updated=0;
  for (const suggestion of parsed.items || []) {
    const current = reels.find(r => r.id === suggestion.id); if (!current) continue;
    await db()`UPDATE reels SET category=${current.category_manual ? current.category : suggestion.category}, subcategory=${current.category_manual ? current.subcategory : suggestion.subcategory}, tags=${current.tags_manual ? current.tags : suggestion.tags}, updated_at=now() WHERE id=${suggestion.id} AND owner_id='owner'`;
    updated++;
  }
  return NextResponse.json({ updated });
}
