import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";

type Category={id:string;name:string;subcategories:string[]};
type SavedVideo={id:string;title:string;url:string;category:string;subcategory:string;tags:string[];notes:string;favorite:boolean;source:string;addedAt:string;status:string;titleLocked?:boolean;categoryLocked:boolean;tagsLocked:boolean;aiStatus:string};
const DEFAULT_CATEGORIES:Category[]=[{id:"food",name:"Food",subcategories:["Breakfast","Entree","Snacks","Drinks","Dessert","Sides","Soups & Salads"]},{id:"travel",name:"Travel",subcategories:["Places","Travel Tips","Hotels & Stays"]},{id:"gardening",name:"Gardening",subcategories:["Plants","Landscaping","Gardening Tips"]},{id:"life",name:"Life Lessons",subcategories:["Motivation","Relationships","Spiritual"]},{id:"other",name:"Other",subcategories:[]},{id:"uncategorized",name:"Uncategorized",subcategories:[]}];
const URL_PATTERN=/https?:\/\/[^\s<>]+/i;
function clean(url:string){return url.replace(/[)>\],.!?]+$/g,"")}
function canonical(raw:string){try{const url=new URL(clean(raw));url.hostname=url.hostname.replace(/^www\./,"").toLowerCase();url.hash="";["igsh","igshid","mibextid","utm_source","utm_medium","utm_campaign","utm_content","si","feature"].forEach(k=>url.searchParams.delete(k));url.searchParams.sort();url.pathname=url.pathname.replace(/\/$/,"");return url.toString().replace(/\?$/,"")}catch{return clean(raw).toLowerCase()}}
function sourceFor(url:string){if(url.includes("instagram.com"))return"Instagram";if(url.includes("facebook.com")||url.includes("fb.watch"))return"Facebook";if(url.includes("youtube.com")||url.includes("youtu.be"))return"YouTube";return"Other"}
async function authorized(request:Request){if(await requireOwner())return true;const expected=process.env.SHARE_API_TOKEN?.trim();const provided=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"").trim();return Boolean(expected&&provided&&expected===provided)}

export async function POST(request:Request){
  if(!(await authorized(request)))return NextResponse.json({error:"Unauthorized"},{status:401});
  const body=await request.json().catch(()=>({})) as {url?:string;text?:string;title?:string};
  const match=[body.url,body.text,body.title].filter(Boolean).join(" ").match(URL_PATTERN);
  if(!match)return NextResponse.json({error:"No video URL was shared"},{status:400});
  const url=clean(match[0]),key=canonical(url),rows=await db()`SELECT data FROM reelrecall_library WHERE owner_id='owner'`,data=(rows[0]?.data??{videos:[],categories:DEFAULT_CATEGORIES}) as {videos:SavedVideo[];categories:Category[]};
  if((data.videos??[]).some(video=>canonical(video.url)===key))return NextResponse.json({ok:true,duplicate:true,message:"Already saved"});
  const description=(body.text??"").replace(match[0],"").trim(),platform=sourceFor(url),video:SavedVideo={id:crypto.randomUUID(),title:body.title?.trim()||description||`${platform} video`,url,category:"Uncategorized",subcategory:"",tags:[],notes:description,favorite:false,source:platform,addedAt:new Date().toISOString(),status:"available",titleLocked:false,categoryLocked:false,tagsLocked:false,aiStatus:"pending"};
  const next={videos:[video,...(data.videos??[])],categories:data.categories?.length?data.categories:DEFAULT_CATEGORIES};
  await db()`INSERT INTO reelrecall_library(owner_id,data,updated_at) VALUES('owner',${JSON.stringify(next)}::jsonb,now()) ON CONFLICT(owner_id) DO UPDATE SET data=EXCLUDED.data,updated_at=now()`;
  return NextResponse.json({ok:true,duplicate:false,id:video.id,message:"Saved to ReelRecall"},{status:201});
}
