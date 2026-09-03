import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";

type WeeklyMenuItem={day?:string;slot?:string;videoId?:string;title?:string;url?:string;source?:string;subcategory?:string};
type SavedWeeklyMenu={id?:string;name?:string;weekStart?:string;items?:WeeklyMenuItem[];createdAt?:string;updatedAt?:string};

function text(value:unknown,max=300){return typeof value==="string"?value.trim().slice(0,max):""}
function sanitizeMenus(value:unknown){
  if(!Array.isArray(value))return[];
  return value.slice(0,100).flatMap(raw=>{
    const menu=(raw&&typeof raw==="object"?raw:{}) as SavedWeeklyMenu;
    const id=text(menu.id,100),name=text(menu.name,180),weekStart=text(menu.weekStart,10);
    if(!id||!name||!/^\d{4}-\d{2}-\d{2}$/.test(weekStart))return[];
    const items=(Array.isArray(menu.items)?menu.items:[]).slice(0,80).flatMap(rawItem=>{
      const item=(rawItem&&typeof rawItem==="object"?rawItem:{}) as WeeklyMenuItem;
      const day=text(item.day,20),slot=text(item.slot,30),videoId=text(item.videoId,120),title=text(item.title,300),url=text(item.url,1500),source=text(item.source,30),subcategory=text(item.subcategory,100);
      if(!day||!slot||!videoId||!title||!/^https?:\/\//i.test(url))return[];
      return[{day,slot,videoId,title,url,source,subcategory}];
    });
    return[{id,name,weekStart,items,createdAt:text(menu.createdAt,40)||new Date().toISOString(),updatedAt:text(menu.updatedAt,40)||new Date().toISOString()}];
  });
}

export async function GET(){
  if(!(await requireOwner()))return NextResponse.json({error:"Unauthorized"},{status:401});
  const rows=await db()`SELECT COALESCE(data->'weeklyMenus','[]'::jsonb) AS menus FROM reelrecall_library WHERE owner_id='owner'`;
  return NextResponse.json({menus:Array.isArray(rows[0]?.menus)?rows[0].menus:[]});
}

export async function PUT(request:Request){
  if(!(await requireOwner()))return NextResponse.json({error:"Unauthorized"},{status:401});
  const body=await request.json() as {menus?:unknown};
  const menus=sanitizeMenus(body.menus);
  const json=JSON.stringify(menus);
  await db()`INSERT INTO reelrecall_library(owner_id,data,updated_at)
    VALUES('owner',jsonb_build_object('weeklyMenus',${json}::jsonb),now())
    ON CONFLICT(owner_id) DO UPDATE
    SET data=jsonb_set(COALESCE(reelrecall_library.data,'{}'::jsonb),'{weeklyMenus}',${json}::jsonb,true),updated_at=now()`;
  return NextResponse.json({ok:true,count:menus.length});
}
