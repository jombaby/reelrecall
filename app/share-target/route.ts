import { NextRequest, NextResponse } from "next/server";

const SHARED_URL_REGEX=/https?:\/\/(?:www\.)?(?:instagram\.com\/(?:reel|reels|p)\/[^\s<>]+|(?:m\.)?facebook\.com\/(?:reel|watch|share\/(?:r|v))\/[^\s<>]+|fb\.watch\/[^\s<>]+|youtube\.com\/(?:shorts\/[^\s<>]+|watch\?[^\s<>]+)|youtu\.be\/[^\s<>]+)/i;

function cleanUrl(value:string){return value.replace(/[)>\],.!?]+$/,"")}
function findSharedUrl(...values:(string|null)[]){for(const value of values){if(!value)continue;const match=value.match(SHARED_URL_REGEX);if(match?.[0])return cleanUrl(match[0])}return null}
function limited(value:string|null,max:number){return value?.replace(/\s+/g," ").trim().slice(0,max)||""}

export function GET(request:NextRequest){
  const params=request.nextUrl.searchParams;
  const shared=findSharedUrl(params.get("url"),params.get("text"),params.get("title"));
  const destination=new URL("/",request.url);
  if(!shared){destination.searchParams.set("shareError","missing-url");return NextResponse.redirect(destination,303)}
  destination.searchParams.set("shared",shared);
  const title=limited(params.get("title"),180),text=limited(params.get("text"),600);
  if(title)destination.searchParams.set("shareTitle",title);
  if(text)destination.searchParams.set("shareText",text);
  return NextResponse.redirect(destination,303);
}
