"use client";

import Image from "next/image";
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Source = "Instagram" | "Facebook" | "YouTube" | "Other";
type Status = "available" | "unavailable";
type Recipe = { title:string; ingredients:string[]; steps:string[]; notes:string; servings:string; prepTime:string; extractedAt:string; source?:"description"|"video"|"manual"; evidence?:string[]; };
type RecipeHistoryEntry={recipe:Recipe;savedAt:string;reason:string};
type RecipeAuditStatus="upgraded"|"added"|"kept"|"protected"|"unavailable"|"failed";
type RecipeAuditItem={videoId:string;title:string;status:RecipeAuditStatus;message:string};
type Video = { id:string; title:string; url:string; category:string; subcategory:string; tags:string[]; notes:string; favorite:boolean; source:Source; addedAt:string; status:Status; titleLocked:boolean; categoryLocked:boolean; tagsLocked:boolean; aiStatus:"pending"|"done"|"failed"; recipe?:Recipe|null ; recipeHistory?:RecipeHistoryEntry[] };
type VideoForm = { title:string; url:string; category:string; subcategory:string; tags:string; notes:string; status:Status };
type Category = { id:string; name:string; subcategories:string[] };
type WeeklyMenuSlot = "Breakfast"|"Lunch"|"Entrée"|"Snack"|"Drink";
type WeeklyMenuItem = { day:string; slot:WeeklyMenuSlot; videoId:string; title:string; url:string; source:Source; subcategory:string };
type SavedWeeklyMenu = { id:string; name:string; weekStart:string; items:WeeklyMenuItem[]; createdAt:string; updatedAt:string };
type RecipeDraft = { title:string; servings:string; prepTime:string; ingredients:string; steps:string; notes:string };
type BatchRecipeState = { running:boolean; total:number; completed:number; success:number; failed:number; currentIds:string[]; failures:{videoId:string;title:string;error:string}[] };
type RetryMode = "auto"|"audio"|"video";
type GrocerySummaryItem = { item:string; quantity:string; usedBy:string[] };
type GroceryListMenuItem = { schedule:string; videoId:string; title:string; ingredients:string[]; recipeMissing:boolean };
type GroceryAisleGroup = { aisle:string; items:GrocerySummaryItem[] };
type GroceryListResult = { menuItems:GroceryListMenuItem[]; summary:GrocerySummaryItem[]; aisleGroups:GroceryAisleGroup[]; generatedAt:string };

// REELRECALL_ANALYSIS_DIAGNOSTICS_UI_V13_1
type AnalysisDiagnostics = {
  resolvedFacebookUrl:string;
  directMp4Found:boolean;
  standardFrameCount:number;
  lateSceneFrameCount:number;
  totalOcrFrameCount:number;
  ocrBatchesAttempted:number;
  ocrBatchesWithText:number;
  rawOcrText:string;
  consolidatedOcrText:string;
};
type ReelAnalysisResult = { videoId:string; status:"success"|"partial"|"error"; source:Source; caption:string; transcript:string; onScreenText:string; thumbnail:string; evidence:string[]; recipe:Recipe|null; message:string; error:string; retrievedAt:string; diagnostics:AnalysisDiagnostics|null };

const STORAGE_KEY="recipe-reel-library:v1", CATEGORY_KEY="video-library:categories:v1";
const URL_REGEX=/https?:\/\/(?:www\.)?(?:instagram\.com\/(?:reel|reels|p)\/[^\s<>]+|(?:m\.)?facebook\.com\/(?:reel|watch|share\/(?:r|v))\/[^\s<>]+|fb\.watch\/[^\s<>]+|youtube\.com\/(?:shorts\/[^\s<>]+|watch\?[^\s<>]+)|youtu\.be\/[^\s<>]+)/gi;
const DEFAULT_CATEGORIES:Category[]=[
  {id:"food",name:"Food",subcategories:["Breakfast","Entree","Snacks","Drinks","Dessert","Sides","Soups & Salads"]},
  {id:"travel",name:"Travel",subcategories:["Places","Travel Tips","Hotels & Stays"]},
  {id:"gardening",name:"Gardening",subcategories:["Plants","Landscaping","Gardening Tips"]},
  {id:"life",name:"Life Lessons",subcategories:["Motivation","Relationships","Spiritual"]},
  {id:"other",name:"Other",subcategories:[]},{id:"uncategorized",name:"Uncategorized",subcategories:[]}
];
const EMPTY_FORM:VideoForm={title:"",url:"",category:"Uncategorized",subcategory:"",tags:"",notes:"",status:"available"};

function cleanUrl(url:string){return url.replace(/[)>\],.!?]+$/,"")}
function isGenericTitle(raw:string){const title=raw.replace(/\u202f/g," ").replace(/\s+/g," ").trim(),words=title.split(/\s+/).filter(Boolean);return!title||/https?:\/\/|www\.|facebook\.com|instagram\.com|youtu(?:be\.com|\.be)/i.test(title)||/^(?:facebook|instagram|youtube|whatsapp|social media|other)(?:\s+(?:post|short|video|reel)(?:\s+\d+)?)?$/i.test(title)||/^(?:shared|saved|forwarded|new)\s+(?:post|short|video|reel)(?:\s+\d+)?$/i.test(title)||/^\[?\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?/i.test(title)||/^[\p{L} .'-]{1,40}:$/u.test(title)||/^#(?:[\p{L}\p{N}_-]+\s*)+$/u.test(title)||/\.(?:mp4|mov|m4v|webm)$/i.test(title)||title.length>100||words.length>14}
function canonicalUrl(raw:string){try{const u=new URL(cleanUrl(raw));u.hostname=u.hostname.replace(/^www\./,"").toLowerCase();if(u.hostname==="m.facebook.com")u.hostname="facebook.com";u.hash="";["igsh","igshid","mibextid","wa_status_inline","share_url","sfnsn","rdid","utm_source","utm_medium","utm_campaign","utm_content","si","feature"].forEach(k=>u.searchParams.delete(k));u.searchParams.sort();if(u.hostname==="instagram.com")u.pathname=u.pathname.replace(/^\/reels\//,"/reel/");if(u.hostname==="facebook.com")u.pathname=u.pathname.replace(/^\/reels\//,"/reel/");u.pathname=u.pathname.replace(/\/$/,"");return u.toString().replace(/\?$/,"")}catch{return cleanUrl(raw).toLowerCase()}}
function sourceFor(url:string):Source{if(url.includes("instagram.com"))return"Instagram";if(url.includes("facebook.com")||url.includes("fb.watch"))return"Facebook";if(url.includes("youtube.com")||url.includes("youtu.be"))return"YouTube";return"Other"}
function sharedIdentity(raw:string){const canonical=canonicalUrl(raw);try{const u=new URL(canonical),host=u.hostname.replace(/^www\./,"").toLowerCase();if(host==="facebook.com"){const reel=u.pathname.match(/\/reels?\/([A-Za-z0-9._-]+)/i)?.[1];if(reel)return`facebook:reel:${reel}`;const watch=u.searchParams.get("v");if(watch&&/^\d+$/.test(watch))return`facebook:video:${watch}`}if(host==="instagram.com"){const reel=u.pathname.match(/\/(?:reel|reels|p)\/([^/?#]+)/i)?.[1];if(reel)return`instagram:${reel}`}return canonical.toLowerCase()}catch{return canonical.toLowerCase()}}

function dateFromLine(line:string){const candidates=[line.match(/^\[([^\]]+)\]/)?.[1],line.match(/^(\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?)/i)?.[1]].filter(Boolean) as string[];for(const value of candidates){const parsed=new Date(value.replace(/\u202f/g," "));if(!Number.isNaN(parsed.getTime()))return parsed.toISOString()}return new Date().toISOString()}
function extractVideos(text:string,existing:Video[]){const seen=new Set(existing.map(v=>canonicalUrl(v.url)));return[...text.matchAll(URL_REGEX)].flatMap((match,index)=>{const url=cleanUrl(match[0]),key=canonicalUrl(url);if(seen.has(key))return[];seen.add(key);const start=text.lastIndexOf("\n",match.index??0)+1,end=text.indexOf("\n",match.index??0),line=text.slice(start,end===-1?undefined:end),label=line.slice(0,line.indexOf(match[0])).replace(/^.*? - (?:You|Me):\s*/i,"").replace(/^\[[^\]]+\]\s*[^:]+:\s*/,"").replace(/^\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?\s*-\s*[^:]+:\s*/i,"").trim(),source=sourceFor(url);return[{id:crypto.randomUUID(),title:label||`${source} video ${existing.length+index+1}`,url,category:"Uncategorized",subcategory:"",tags:[],notes:label,favorite:false,source,addedAt:dateFromLine(line),status:"available" as Status,titleLocked:false,categoryLocked:false,tagsLocked:false,aiStatus:"pending" as const}]})}
function normalizeStoredVideos(items:Partial<Video>[]){const foodSubs=DEFAULT_CATEGORIES[0].subcategories;return items.map(v=>{const legacyFood=foodSubs.includes(v.category??""),resolvedCategory=legacyFood?"Food":v.category??"Uncategorized",resolvedTags=v.tags??[],resolvedTitle=v.title??"";return({...v,title:resolvedTitle,category:resolvedCategory,subcategory:legacyFood?v.category??"":v.subcategory??"",tags:resolvedTags,status:v.status??"available",addedAt:v.addedAt??new Date().toISOString(),titleLocked:v.titleLocked??!isGenericTitle(resolvedTitle),categoryLocked:v.categoryLocked??resolvedCategory!=="Uncategorized",tagsLocked:v.tagsLocked??resolvedTags.length>0,aiStatus:v.aiStatus??"done",recipe:v.recipe??null}) as Video})}
async function sampleVideoFrames(file:File,count=10){const objectUrl=URL.createObjectURL(file),video=document.createElement("video");video.src=objectUrl;video.preload="metadata";video.muted=true;video.playsInline=true;await new Promise<void>((resolve,reject)=>{video.onloadedmetadata=()=>resolve();video.onerror=()=>reject(new Error("Video could not be opened"))});const duration=Number.isFinite(video.duration)&&video.duration>0?video.duration:1,canvas=document.createElement("canvas"),ctx=canvas.getContext("2d");if(!ctx){URL.revokeObjectURL(objectUrl);throw new Error("Canvas unavailable")}const frames:string[]=[];for(let i=0;i<count;i++){const time=Math.max(0,Math.min(Math.max(0,duration-.05),duration*((i+.5)/count)));await new Promise<void>((resolve,reject)=>{const done=()=>{cleanup();resolve()},bad=()=>{cleanup();reject(new Error("Could not read video frame"))},cleanup=()=>{video.removeEventListener("seeked",done);video.removeEventListener("error",bad)};video.addEventListener("seeked",done,{once:true});video.addEventListener("error",bad,{once:true});video.currentTime=time});const scale=Math.min(1,768/Math.max(video.videoWidth||1,video.videoHeight||1)),width=Math.max(1,Math.round((video.videoWidth||1)*scale)),height=Math.max(1,Math.round((video.videoHeight||1)*scale));canvas.width=width;canvas.height=height;ctx.drawImage(video,0,0,width,height);frames.push(canvas.toDataURL("image/jpeg",.7))}URL.revokeObjectURL(objectUrl);return frames}
// REELRECALL_RECIPE_PROTECTION_AUDIT_V1
function recipeDetailScore(recipe:Recipe){
  const ingredientText=recipe.ingredients.join(" ").length;
  const stepText=recipe.steps.join(" ").length;
  return recipe.ingredients.length*14+recipe.steps.length*12+Math.min(ingredientText,1200)/20+Math.min(stepText,1800)/25+(recipe.notes?Math.min(recipe.notes.length,400)/40:0)+(recipe.servings?4:0)+(recipe.prepTime?4:0);
}
function descriptionRecipeIsRicher(current:Recipe,candidate:Recipe){
  const currentIngredients=current.ingredients.filter(Boolean).length;
  const candidateIngredients=candidate.ingredients.filter(Boolean).length;
  const currentSteps=current.steps.filter(Boolean).length;
  const candidateSteps=candidate.steps.filter(Boolean).length;

  const noMajorIngredientRegression=candidateIngredients>=Math.max(1,Math.floor(currentIngredients*.8));
  const noMajorStepRegression=candidateSteps>=Math.max(1,Math.floor(currentSteps*.8));

  const structurallyBetter=
    (candidateIngredients>currentIngredients&&candidateSteps>=currentSteps)||
    (candidateSteps>currentSteps&&candidateIngredients>=currentIngredients);

  const materiallyRicher=
    noMajorIngredientRegression&&
    noMajorStepRegression&&
    recipeDetailScore(candidate)>=recipeDetailScore(current)*1.18;

  return structurallyBetter||materiallyRicher;
}
function archiveCurrentRecipe(video:Video,reason:string){
  if(!video.recipe)return video.recipeHistory??[];
  return[
    {recipe:video.recipe,savedAt:new Date().toISOString(),reason},
    ...(video.recipeHistory??[])
  ].slice(0,25);
}
function applyRecipeCandidate(video:Video,incoming:Recipe,origin:"description"|"video"|"manual",force=false):Video{
  const candidate:{source?:"description"|"video"|"manual"}&Recipe={...incoming,source:origin};

  if(!video.recipe){
    return{...video,recipe:candidate};
  }

  if(origin==="video"&&!force){
    if(video.recipe.source==="manual"||video.recipe.source==="description")return video;
    if(recipeDetailScore(candidate)<recipeDetailScore(video.recipe))return video;
  }

  if(origin==="description"&&!force&&!descriptionRecipeIsRicher(video.recipe,candidate)){
    return video;
  }

  return{
    ...video,
    recipe:candidate,
    recipeHistory:archiveCurrentRecipe(video,`${origin} recipe replaced the saved recipe`)
  };
}

function recipeText(video:Video){const r=video.recipe;if(!r)return"";return[r.title,r.servings?`Servings: ${r.servings}`:"",r.prepTime?`Time: ${r.prepTime}`:"","Ingredients",...r.ingredients.map(x=>`• ${x}`),"","Steps",...r.steps.map((x,i)=>`${i+1}. ${x}`),r.notes?`\nNotes\n${r.notes}`:"",`\nSource: ${video.url}`].filter(Boolean).join("\n")}
function youtubeId(raw:string){try{const u=new URL(raw);if(u.hostname.includes("youtu.be"))return u.pathname.split("/").filter(Boolean)[0];if(u.pathname.startsWith("/shorts/"))return u.pathname.split("/")[2];return u.searchParams.get("v")}catch{return null}}
function embedUrl(video:Video){if(video.source==="YouTube"){const id=youtubeId(video.url);return id?`https://www.youtube.com/embed/${id}?autoplay=1&rel=0`:null}if(video.source==="Instagram"){try{const u=new URL(video.url),p=u.pathname.split("/").filter(Boolean);return p[1]?`https://www.instagram.com/reel/${p[1]}/embed/`:null}catch{return null}}return null}

function InstagramEmbed({url,title}:{url:string;title:string}){
  const[html,setHtml]=useState(""),[ready,setReady]=useState(false);const containerRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{let active=true;setReady(false);fetch(`/api/embed?url=${encodeURIComponent(url)}`).then(r=>r.ok?r.json():Promise.reject()).then((data:{html?:string})=>{if(active&&data.html)setHtml(data.html)}).catch(()=>{if(active)setHtml("")});return()=>{active=false}},[url]);
  useEffect(()=>{if(!html)return;const process=()=>{const api=(window as Window&{instgrm?:{Embeds:{process:()=>void}}}).instgrm;if(api){api.Embeds.process()}};const markReady=()=>{if(containerRef.current?.querySelector("iframe"))setReady(true)};const observer=new MutationObserver(markReady);if(containerRef.current)observer.observe(containerRef.current,{childList:true,subtree:true});const existing=document.querySelector<HTMLScriptElement>('script[src="https://www.instagram.com/embed.js"]');if((window as Window&{instgrm?:unknown}).instgrm){process()}else if(existing){existing.addEventListener("load",process,{once:true})}else{const script=document.createElement("script");script.async=true;script.src="https://www.instagram.com/embed.js";script.addEventListener("load",process,{once:true});document.body.appendChild(script)}const retry=window.setTimeout(()=>{process();markReady()},500);return()=>{observer.disconnect();window.clearTimeout(retry);existing?.removeEventListener("load",process)}},[html]);
  return <div ref={containerRef} className={`instagram-player ${ready?"ready":"processing"}`} aria-label={title}>{html?<div dangerouslySetInnerHTML={{__html:html}}/>:<div className="embed-loading">Loading Instagram video…</div>}{html&&!ready?<div className="embed-shield">Preparing inline player…</div>:null}</div>
}

function FacebookEmbed({url,title,thumbnail,onThumbnailError}:{url:string;title:string;thumbnail:string|null;onThumbnailError:()=>void}){
  const[html,setHtml]=useState<string|null>(null),[ready,setReady]=useState(false),[fallback,setFallback]=useState(false);const containerRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{let active=true;setHtml(null);setReady(false);setFallback(false);fetch(`/api/facebook-embed?url=${encodeURIComponent(url)}`).then(async r=>{if(!r.ok)throw new Error("Embed unavailable");return r.json() as Promise<{html?:string}>}).then(data=>{if(active&&data.html)setHtml(data.html);else if(active)setFallback(true)}).catch(()=>{if(active)setFallback(true)});return()=>{active=false}},[url]);
  useEffect(()=>{if(!html||fallback)return;const markReady=()=>{if(containerRef.current?.querySelector("iframe"))setReady(true)};const process=()=>{markReady();const api=(window as Window&{FB?:{XFBML?:{parse:(root?:HTMLElement)=>void}}}).FB;api?.XFBML?.parse(containerRef.current??undefined)};const observer=new MutationObserver(markReady);if(containerRef.current)observer.observe(containerRef.current,{childList:true,subtree:true});markReady();const existing=document.querySelector<HTMLScriptElement>('script[data-reelrecall-facebook-sdk="true"]');const onLoad=()=>process();if((window as Window&{FB?:unknown}).FB){process()}else if(existing){existing.addEventListener("load",onLoad,{once:true})}else{const script=document.createElement("script");script.async=true;script.defer=true;script.crossOrigin="anonymous";script.dataset.reelrecallFacebookSdk="true";script.src="https://connect.facebook.net/en_US/sdk.js#xfbml=1&version=v25.0";script.addEventListener("load",onLoad,{once:true});document.body.appendChild(script)}const retry=window.setTimeout(process,500),giveUp=window.setTimeout(()=>{if(!containerRef.current?.querySelector("iframe"))setFallback(true)},7000);return()=>{observer.disconnect();window.clearTimeout(retry);window.clearTimeout(giveUp);existing?.removeEventListener("load",onLoad)}},[html,fallback]);
  if(fallback)return <div className={`facebook-fallback ${thumbnail?"has-thumbnail":""}`}>{thumbnail?<img src={thumbnail} alt="" onError={onThumbnailError}/>:null}<div className="facebook-fallback-copy"><strong>This reel can’t be played inline.</strong><small>It may require Facebook login or have audience or embedding restrictions.</small><a href={url} target="_blank" rel="noreferrer">Watch in Facebook ↗</a></div></div>;
  return <div ref={containerRef} className={`facebook-player ${ready?"ready":"processing"}`} aria-label={title}>{html?<div dangerouslySetInnerHTML={{__html:html}}/>:<div className="embed-loading">Checking Facebook playback…</div>}{html&&!ready?<div className="embed-shield">Preparing Facebook player…</div>:null}</div>
}

function VideoCard({video,playing,onPlay,onEdit,onDelete,onFavorite,onStatus,onRecipe,recipeLoading,onAnalyzeVideo,videoAnalyzing,analysisReady}:{video:Video;playing:boolean;onPlay:()=>void;onEdit:()=>void;onDelete:()=>void;onFavorite:()=>void;onStatus:()=>void;onRecipe:()=>void;recipeLoading:boolean;onAnalyzeVideo:()=>void;videoAnalyzing:boolean;analysisReady:boolean}){
  const[thumbnail,setThumbnail]=useState<string|null>(null),[failed,setFailed]=useState(false);
  useEffect(()=>{let active=true;setThumbnail(null);setFailed(false);fetch(`/api/thumbnail?url=${encodeURIComponent(video.url)}`).then(r=>r.ok?r.json():Promise.reject()).then((d:{thumbnail?:string})=>{if(active&&d.thumbnail)setThumbnail(d.thumbnail)}).catch(()=>{if(active)setFailed(true)});return()=>{active=false}},[video.url]);
  const player=embedUrl(video),unavailable=video.status==="unavailable",watchLabel=video.source==="Facebook"?"Watch in Facebook ↗":"Open original ↗";
  return <article data-video-id={video.id} className={`recipe-card ${unavailable?"unavailable":""}`}><div className={`source-badge ${video.source.toLowerCase()}`}>{video.source}</div><button className={`heart ${video.favorite?"active":""}`} onClick={onFavorite}>♥</button>
    {unavailable?<div className="not-available"><span>{video.source==="Facebook"?"This reel may no longer be available":"Video marked unavailable"}</span><small>{video.source==="Facebook"?"You marked this item unavailable. Open Facebook to verify its current state.":"You marked this item unavailable."}</small>{video.source==="Facebook"?<a href={video.url} target="_blank" rel="noreferrer">Watch in Facebook ↗</a>:null}</div>:playing&&video.source==="Facebook"?<FacebookEmbed url={video.url} title={video.title} thumbnail={thumbnail&&!failed?thumbnail:null} onThumbnailError={()=>setFailed(true)}/>:playing&&video.source==="Instagram"?<InstagramEmbed url={video.url} title={video.title}/>:playing&&player?<div className="inline-player"><iframe src={player} title={video.title} allow="autoplay; encrypted-media; picture-in-picture; web-share" allowFullScreen/></div>:<button className="reel-art" onClick={onPlay} aria-label={`Play ${video.title}`}>{thumbnail&&!failed?<img src={thumbnail} alt="" onError={()=>setFailed(true)}/>:<span className="plate">{video.category==="Travel"?"✈️":video.category==="Gardening"?"🌿":video.category==="Life Lessons"?"💡":video.category==="Food"?"🍲":"🎬"}</span>}<span className="play">▶</span></button>}
    <div className="card-body"><p className="eyebrow">{video.category}{video.subcategory?` · ${video.subcategory}`:""}</p><h2>{video.title}</h2><p className="saved-date">Saved {new Date(video.addedAt).toLocaleString()}</p>{video.tags.length?<div className="tags">{video.tags.map(t=><span key={t}>{t}</span>)}</div>:null}{video.notes?<p className="notes">{video.notes}</p>:<p className="notes muted">Add a note about this video.</p>}<div className="card-actions">{video.category==="Food"?(video.recipe?<button className="recipe-action" onClick={onRecipe}>🍳 Recipe</button>:<button className="recipe-action video-analysis" onClick={onAnalyzeVideo} disabled={videoAnalyzing}>{videoAnalyzing?"Analyzing…":analysisReady?"📋 View Analysis":"🎥 Analyze Video"}</button>):null}<a href={video.url} target="_blank" rel="noreferrer" className="watch">{watchLabel}</a><button type="button" className="video-card-edit-action" onClick={e=>{e.preventDefault();e.stopPropagation();onEdit()}}>Edit</button><button onClick={onStatus}>{unavailable?"Restore":"Mark unavailable"}</button><button className="delete" onClick={onDelete}>Delete</button></div></div></article>
}


const WEEKLY_RETRY_TIMEOUT_MS=75000;

async function fetchWithWeeklyRetryTimeout(
  input:Parameters<typeof fetch>[0],
  init?:Parameters<typeof fetch>[1]
){
  const controller=new AbortController();
  const timer=window.setTimeout(()=>controller.abort(),WEEKLY_RETRY_TIMEOUT_MS);
  try{
    return await fetch(input,{...(init??{}),signal:controller.signal});
  }finally{
    window.clearTimeout(timer);
  }
}

const WEEKLY_MENU_DAYS=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"] as const;
const WEEKLY_MENU_SLOTS:WeeklyMenuSlot[]=["Breakfast","Lunch","Entrée","Snack","Drink"];

function currentMondayISO(){
  const d=new Date(),day=d.getDay(),offset=day===0?-6:1-day;
  d.setHours(12,0,0,0);d.setDate(d.getDate()+offset);
  return d.toISOString().slice(0,10);
}
function shiftWeekISO(iso:string,weeks:number){
  const d=new Date(`${iso}T12:00:00`);d.setDate(d.getDate()+weeks*7);return d.toISOString().slice(0,10);
}
function weekTitle(iso:string){
  const start=new Date(`${iso}T12:00:00`),end=new Date(start);end.setDate(end.getDate()+6);
  const fmt=new Intl.DateTimeFormat(undefined,{month:"short",day:"numeric"});
  return `${fmt.format(start)} – ${fmt.format(end)}, ${end.getFullYear()}`;
}
function dayDateLabel(weekStart:string,index:number){
  const d=new Date(`${weekStart}T12:00:00`);d.setDate(d.getDate()+index);
  return new Intl.DateTimeFormat(undefined,{month:"short",day:"numeric"}).format(d);
}
function slotText(video:Video){
  return [video.subcategory,video.title,...video.tags].join(" ").toLowerCase().replace(/[éèê]/g,"e");
}
function matchesWeeklySlot(video:Video,slot:WeeklyMenuSlot){
  const text=slotText(video);
  if(slot==="Breakfast")return /\b(breakfast|brunch|pancake|waffle|omelet|oat|cereal)\b/.test(text);
  if(slot==="Lunch")return /\b(lunch|soup|salad|sandwich|wrap|side|entree|main)\b/.test(text);
  if(slot==="Entrée")return /\b(entree|main|dinner|supper|curry|pasta|chicken|beef|pork|rice|noodle)\b/.test(text);
  if(slot==="Snack")return /\b(snack|snacks|appetizer|bite|finger food|dessert)\b/.test(text);
  return /\b(drink|drinks|beverage|smoothie|juice|shake|coffee|tea|mocktail|cocktail)\b/.test(text);
}
function menuItemFromVideo(day:string,slot:WeeklyMenuSlot,video:Video):WeeklyMenuItem{
  return{day,slot,videoId:video.id,title:video.title,url:video.url,source:video.source,subcategory:video.subcategory};
}
function matchingWeeklyVideos(videos:Video[],slot:WeeklyMenuSlot){
  const food=videos.filter(v=>v.status==="available"&&v.category.toLowerCase()==="food");
  let matches=food.filter(v=>matchesWeeklySlot(v,slot));
  if(!matches.length&&slot==="Lunch")matches=food.filter(v=>/\b(entree|soup|salad|side)\b/.test(slotText(v)));
  return matches;
}
function chooseWeeklyVideo(videos:Video[],slot:WeeklyMenuSlot,used:Set<string>){
  const matches=matchingWeeklyVideos(videos,slot);
  if(!matches.length)return null;
  const unused=matches.filter(v=>!used.has(v.id)),pool=unused.length?unused:matches;
  return pool[Math.floor(Math.random()*pool.length)]??null;
}
function generateWeeklyItems(videos:Video[]){
  const used=new Set<string>(),items:WeeklyMenuItem[]=[];
  for(const day of WEEKLY_MENU_DAYS)for(const slot of WEEKLY_MENU_SLOTS){
    const video=chooseWeeklyVideo(videos,slot,used);
    if(video){used.add(video.id);items.push(menuItemFromVideo(day,slot,video))}
  }
  return items;
}

function groceryAisleFor(raw:string){
  const item=raw.toLowerCase();
  if(/\b(black pepper|peppercorn|paprika|cumin|turmeric|cardamom|cinnamon|clove|nutmeg|garam masala|curry powder|chili powder|chilli powder|chili flakes|chilli flakes|onion powder|garlic powder|coriander powder|coriander seeds|asafoetida|hing|seasoning|oregano|thyme|rosemary|bay leaves|salt|saffron|sesame seeds|dried red chili|dry red chili)\b/.test(item))return"Spices & Seasonings";
  if(/\b(oil|vinegar|soy sauce|hot sauce|ketchup|mustard|mayonnaise|mayo|sriracha|honey|maple syrup|sauce|paste|dressing|chutney)\b/.test(item))return"Sauces, Oils & Condiments";
  if(/\b(coconut milk|broth|bouillon|stock|tomato paste|tomato sauce|canned|beans|chickpeas|lentils)\b/.test(item))return"Canned & Jarred";
  if(/\b(milk|cream|butter|cheese|yogurt|yoghurt|egg|eggs|paneer|sour cream|half and half|feta|mozzarella|parmesan)\b/.test(item))return"Dairy & Eggs";
  if(/\b(chicken|beef|pork|turkey|lamb|steak|sausage|bacon|shrimp|prawn|salmon|tuna|tilapia|fish|crab|lobster)\b/.test(item))return"Meat & Seafood";
  if(/\b(onion|garlic|ginger|tomato|potato|carrot|celery|bell pepper|capsicum|spinach|lettuce|cabbage|cauliflower|broccoli|cilantro|coriander|parsley|mint|basil|lemon|lime|orange|apple|banana|mango|pineapple|avocado|cucumber|zucchini|mushroom|green bean|peas|corn|jalapeno|red chili|beet|watermelon|strawberr|blueberr|kiwi|asparagus|sweet potato|curry leaves)\b/.test(item))return"Produce";
  if(/\b(bread|bun|roll|tortilla|pita|naan|bagel|croissant|tostada shell)\b/.test(item))return"Bakery & Bread";
  if(/\b(rice|pasta|noodle|spaghetti|macaroni|quinoa|oat|oats|couscous|barley|rava|semolina)\b/.test(item))return"Rice, Pasta & Grains";
  if(/\b(baking soda|baking powder|yeast|vanilla|cocoa|chocolate|sugar|brown sugar|powdered sugar|cornstarch|flour)\b/.test(item))return"Baking";
  if(/\b(frozen|ice cream)\b/.test(item))return"Frozen";
  if(/\b(coffee|tea|chai|juice|soda|sparkling water|coconut water|drink)\b/.test(item))return"Beverages";
  return"Pantry & Dry Goods";
}
function groupGrocerySummaryByAisle(summary:GrocerySummaryItem[]){
  const order=["Produce","Meat & Seafood","Dairy & Eggs","Bakery & Bread","Rice, Pasta & Grains","Canned & Jarred","Spices & Seasonings","Sauces, Oils & Condiments","Baking","Frozen","Beverages","Pantry & Dry Goods"];
  const groups=new Map<string,GrocerySummaryItem[]>();
  for(const item of summary){const aisle=groceryAisleFor(item.item);groups.set(aisle,[...(groups.get(aisle)??[]),item])}
  return order.filter(aisle=>groups.has(aisle)).map(aisle=>({aisle,items:(groups.get(aisle)??[]).sort((a,b)=>a.item.localeCompare(b.item))}));
}

const GROCERY_UNICODE_FRACTIONS:Record<string,number>={"¼":.25,"½":.5,"¾":.75,"⅓":1/3,"⅔":2/3,"⅛":.125,"⅜":.375,"⅝":.625,"⅞":.875};
const GROCERY_WORD_NUMBERS:Record<string,number>={one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,half:.5};

function groceryNumber(raw:string){
  const value=raw.trim().toLowerCase();
  if(!value)return null;
  if(value in GROCERY_UNICODE_FRACTIONS)return GROCERY_UNICODE_FRACTIONS[value];
  if(value in GROCERY_WORD_NUMBERS)return GROCERY_WORD_NUMBERS[value];
  const mixed=value.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if(mixed)return Number(mixed[1])+Number(mixed[2])/Number(mixed[3]);
  const fraction=value.match(/^(\d+)\/(\d+)$/);
  if(fraction)return Number(fraction[1])/Number(fraction[2]);
  const parsed=Number(value);
  return Number.isFinite(parsed)?parsed:null;
}
function cleanGroceryQuantity(raw:string){
  const cleaned=raw.replace(/\bas listed in recipes\b/gi,"").replace(/\b(?:exact\s+)?amount\s+not\s+specified\b/gi,"").replace(/\s+/g," ").replace(/^[-–—,:;\s]+|[-–—,:;\s]+$/g,"").trim();
  if(!cleaned||/^(?:a little|a piece|a handful|handful|a pinch|a few|few|some|as needed|to taste)$/i.test(cleaned))return"";
  return cleaned;
}
function groceryQuantityToken(raw:string){
  const value=raw.trim().toLowerCase();
  if(value in GROCERY_WORD_NUMBERS)return String(GROCERY_WORD_NUMBERS[value]);
  return raw;
}
function normalizeGroceryIngredientText(raw:string){
  let value=raw
    .replace(/\bas listed in recipes\b/gi,"")
    .replace(/[•*]/g," ")
    .replace(/\s+/g," ")
    .trim();
  const amountOf=value.match(/^amount\s+of\s+(.+?)\s+not\s+specified$/i);
  if(amountOf)value=amountOf[1];
  value=value
    .replace(/\s*[-–—,:;]+\s*(?:otherwise\s+)?(?:exact\s+)?amount\s+not\s+specified.*$/i,"")
    .replace(/\s*,?\s*(?:exact\s+)?amount\s+not\s+specified.*$/i,"")
    .replace(/\s+/g," ")
    .replace(/^[-–—,:;\s]+|[-–—,:;\s]+$/g,"")
    .trim();
  return value;
}
function expandCompoundGroceryIngredient(raw:string){
  const value=normalizeGroceryIngredientText(raw);
  if(!value)return[];
  const juice=value.match(/^([^:]{2,80}\bjuice)\s*:\s*(.+)$/i);
  if(juice&&juice[2].includes(","))return juice[2].split(",").map(item=>item.trim()).filter(Boolean);
  if(/^salt\s+and\s+black\s+pepper\b/i.test(value))return["Salt","Black Pepper"];
  if(/^ginger\s+and\s+garlic\b/i.test(value))return["Ginger","Garlic"];
  return[value];
}
function splitGroceryItemQuantity(raw:string){
  let item=normalizeGroceryIngredientText(raw),quantity="";
  if(!item)return{item:"",quantity:""};

  const juiceOf=item.match(/^juice\s+of\s+(\d+)\s+(.+)$/i);
  if(juiceOf)return{item:juiceOf[2],quantity:juiceOf[1]};

  const halfKg=item.match(/^half\s+(kg|kilogram|kilograms)\s+(.+)$/i);
  if(halfKg)return{item:halfKg[2],quantity:"0.5 kg"};
  const halfItem=item.match(/^half\s+(?:an?|one)\s+(.+)$/i);
  if(halfItem)return{item:halfItem[1],quantity:"0.5"};

  item=item
    .replace(/^(?:a\s+little|a\s+piece\s+of|a\s+handful\s+of|handful\s+of|a\s+pinch\s+of|a\s+few|few)\s+/i,"")
    .replace(/^(?:washed|ripe|seedless)\s+/i,"")
    .trim();

  const num='(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞]|one|two|three|four|five|six|seven|eight|nine|ten)';
  const unit='(?:cups?|tbsp|tablespoons?|tbsps?|tsp|teaspoons?|lbs?|pounds?|oz|ounces?|kgs?|kilograms?|grams?|g|gms?|ml|milliliters?|liters?|litres?|l|cloves?|cans?|packages?|packs?|pieces?|pcs?|bunches?|bunch|sprigs?|cubes?|nos?|slices?)';
  const leading=new RegExp(`^-?\\s*(${num})\\s*(${unit})?\\b\\s*(.+)$`,"i");
  const trailing=new RegExp(`^(.+?)\\s*[-–—,:;]?\\s+(${num})\\s*(${unit})?\\s*$`,"i");
  const lead=item.match(leading),tail=item.match(trailing);
  if(lead){quantity=cleanGroceryQuantity(`${groceryQuantityToken(lead[1])}${lead[2]?` ${lead[2]}`:""}`);item=lead[3].trim()}
  else if(tail){item=tail[1].trim();quantity=cleanGroceryQuantity(`${groceryQuantityToken(tail[2])}${tail[3]?` ${tail[3]}`:""}`)}

  item=item
    .replace(/\s*[-–—,:;]+\s*(?:a\s+little|a\s+handful|a\s+pinch|a\s+few(?:\s+slices?)?|few\s+slices?|some|as\s+needed|to\s+taste|two\s+cubes?)\s*$/i,"")
    .replace(/^(?:tbsp|tablespoons?|tbsps?|tsp|teaspoons?|cups?|grams?|gms?)\s+/i,"")
    .replace(/\s+/g," ")
    .trim();
  return{item,quantity};
}
function canonicalGroceryItem(raw:string){
  let item=normalizeGroceryIngredientText(raw).toLowerCase();
  if(!item)return"";

  item=item
    .replace(/,\s*(?:as\s+a\s+substitute\s+for|substitute\s+for|any\s+color|seeds?\s+removed|for\s+fluffier\s+texture).*$/i,"")
    .replace(/\byou\s+can\s+also\s+mix\s+both\b.*$/i,"")
    .replace(/\bwith\s+skin\b/g," ")
    .replace(/\b(?:washed|fresh|finely|roughly|thinly|thickly|chopped|diced|minced|sliced|grated|shredded|crushed|peeled|trimmed|divided|optional|for garnish|for serving|ripe|seedless|soft|hot|crispy|cubed|soaked|cooked|frozen|roasted|extra|for topping)\b/g," ")
    .replace(/\s+/g," ")
    .trim();

  if(/^(?:water\b|hot water\b|glass of water\b)/.test(item))return"";
  if(/^(?:foil|ingredient unclear|dry ingredients?|ice cream sticks?(?: or toothpicks)?|toothpicks?)$/.test(item))return"";
  if(/^lemon rice$/.test(item))return"";

  if(/^butter\s+or\s+olive\s+oil$/.test(item))return"Butter or Olive Oil";
  if(/^basil\s+or\s+parsley$/.test(item))return"Basil or Parsley";
  if(/^cheddar\s+or\s+mozzarella/.test(item))return"Cheddar or Mozzarella";

  if(/\beggs?\b/.test(item)&&!/(eggplant|egg noodle)/.test(item))return"Eggs";
  if(/\bchicken\s+breasts?\b/.test(item))return"Chicken Breast";
  if(/\bchicken\s+thighs?\b/.test(item))return"Chicken Thigh";
  if(/\bchicken\s+leg\b/.test(item))return"Chicken Leg";
  if(/\bchicken\b/.test(item)&&!/\b(?:broth|bouillon)\b/.test(item))return"Chicken";
  if(/\b(?:shrimp|prawns?)\b/.test(item))return"Shrimp";
  if(/\bground\s+beef\b/.test(item))return"Ground Beef";
  if(/\bsirloin\s+steak\b|\bsteak\b/.test(item))return"Steak";

  if(/^(?:baby\s+)?spinach$/.test(item))return"Spinach";
  if(/^kale$/.test(item))return"Kale";
  if(/^(?:cilantro|coriander)$/.test(item))return"Cilantro";
  if(/^parsley$/.test(item))return"Parsley";
  if(/^garlic(?:\s+cloves?)?$/.test(item))return"Garlic";
  if(/^(?:garlic\s+granules?|garlic\s+powder)$/.test(item))return"Garlic Powder";
  if(/^(?:onion\s+granules?|onion\s+powder)$/.test(item))return"Onion Powder";
  if(/^red\s+onions?$/.test(item))return"Red Onion";
  if(/^onions?$/.test(item))return"Onion";
  if(/^cherry\s+tomatoes?$/.test(item))return"Cherry Tomatoes";
  if(/^sun[- ]?dried\s+tomatoes?$/.test(item))return"Sun-Dried Tomatoes";
  if(/^tomatoes?$/.test(item))return"Tomato";
  if(/^potatoes?$/.test(item))return"Potato";
  if(/^sweet\s+potatoes?$/.test(item))return"Sweet Potato";
  if(/^carrots?$/.test(item))return"Carrot";
  if(/^celery(?:\s+stalks?)?$/.test(item))return"Celery";
  if(/^bell\s+peppers?$/.test(item))return"Bell Pepper";
  if(/^(?:black\s+pepper(?:\s+powder|corns?)?|pepper\s+powder|pepper)$/.test(item))return"Black Pepper";
  if(/^paprika(?:\s+powder)?$/.test(item))return"Paprika";
  if(/^chilli\s+powder$|^chili\s+powder$/.test(item))return"Chili Powder";
  if(/^chilli\s+flakes$|^chili\s+flakes$/.test(item))return"Chili Flakes";
  if(/^dry\s+red\s+chill?i$|^dried\s+red\s+chill?i$/.test(item))return"Dried Red Chili";
  if(/^red\s+chilli$|^red\s+chili$/.test(item))return"Red Chili";
  if(/^cumin\s+powder$|^cumin$/.test(item))return"Cumin";
  if(/^cumin\s+seeds?$/.test(item))return"Cumin Seeds";
  if(/^turmeric(?:\s+powder)?$/.test(item))return"Turmeric";
  if(/^cardamom(?:\s+powder)?$/.test(item))return"Cardamom";
  if(/^(?:aromatic|coarse|red)?\s*salt(?:\s+ocr.*)?$/.test(item))return"Salt";

  if(/^beetroot$|^beets?$/.test(item))return"Beets";
  if(/^lemons?$/.test(item))return"Lemon";
  if(/^limes?$/.test(item))return"Lime";
  if(/^avocados?$/.test(item))return"Avocado";
  if(/^cucumbers?$/.test(item))return"Cucumber";
  if(/^mushrooms?$/.test(item))return"Mushroom";
  if(/^bananas?(?:\s+slices?)?$/.test(item))return"Banana";
  if(/^green\s+apples?$/.test(item))return"Green Apple";
  if(/^red\s+apples?$/.test(item))return"Red Apple";
  if(/^apples?$/.test(item))return"Apple";
  if(/^pineapple$/.test(item))return"Pineapple";
  if(/^strawberries$/.test(item))return"Strawberries";
  if(/^blueberries(?:\s+for\s+topping)?$/.test(item))return"Blueberries";
  if(/^kiwis?$/.test(item))return"Kiwi";
  if(/^watermelon(?:\s+cubes?)?$/.test(item))return"Watermelon";

  if(/^(?:thick\s+)?greek\s+yogurt$/.test(item))return"Greek Yogurt";
  if(/^yogurt$/.test(item))return"Yogurt";
  if(/^cottage\s+cheese$/.test(item))return"Cottage Cheese";
  if(/^mozzarella(?:\s+cheese)?$/.test(item))return"Mozzarella";
  if(/^parmesan(?:\s+cheese)?$/.test(item))return"Parmesan";
  if(/^milk$/.test(item))return"Milk";
  if(/^butter$/.test(item))return"Butter";
  if(/^coconut\s+milk$/.test(item))return"Coconut Milk";

  if(/^natural\s+honey$|^honey$/.test(item))return"Honey";
  if(/^oil(?:\s+for\s+frying)?$/.test(item))return"Cooking Oil";
  if(/^olive\s+oil$/.test(item))return"Olive Oil";
  if(/^avocado\s+oil$/.test(item))return"Avocado Oil";
  if(/^coconut\s+oil$/.test(item))return"Coconut Oil";
  if(/^coconut\s+water(?:,.*)?$/.test(item))return"Coconut Water";

  if(/^bread(?:,.*)?$/.test(item))return"Bread";
  if(/^rolled\s+oats$|^oats$/.test(item))return"Oats";
  if(/^(?:gms?\s+)?chickpeas?$/.test(item))return"Chickpeas";
  if(/^asafoetida\s+hing$|^hing$/.test(item))return"Asafoetida (Hing)";
  if(/^rava$/.test(item))return"Semolina (Rava)";
  if(/^scoop\s+vanilla\s+protein$|^vanilla\s+protein$/.test(item))return"Vanilla Protein Powder";
  if(/^white\s+sesame\s+seeds?$/.test(item))return"Sesame Seeds";
  if(/^peanuts?$/.test(item))return"Peanuts";

  return item.split(" ").filter(Boolean).map(word=>word.charAt(0).toUpperCase()+word.slice(1)).join(" ")||raw.trim();
}
function groceryMeasurement(raw:string){
  const value=cleanGroceryQuantity(raw).toLowerCase();
  if(!value)return null;
  const match=value.match(/^((?:\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞]))(?:\s*)(.*)$/);
  if(!match)return null;
  const amount=groceryNumber(match[1]);
  if(amount==null)return null;
  const unit=match[2].trim().replace(/\.$/,"");
  if(!unit)return{amount,kind:"count" as const,base:amount,label:""};
  if(/^(?:lb|lbs|pound|pounds)$/.test(unit))return{amount,kind:"weight" as const,base:amount*16,label:"oz"};
  if(/^(?:oz|ounce|ounces)$/.test(unit))return{amount,kind:"weight" as const,base:amount,label:"oz"};
  if(/^(?:kg|kgs|kilogram|kilograms)$/.test(unit))return{amount,kind:"metric-weight" as const,base:amount*1000,label:"g"};
  if(/^(?:g|gram|grams|gm|gms)$/.test(unit))return{amount,kind:"metric-weight" as const,base:amount,label:"g"};
  if(/^(?:cup|cups)$/.test(unit))return{amount,kind:"volume" as const,base:amount*48,label:"tsp"};
  if(/^(?:tbsp|tablespoon|tablespoons|tbsps)$/.test(unit))return{amount,kind:"volume" as const,base:amount*3,label:"tsp"};
  if(/^(?:tsp|teaspoon|teaspoons)$/.test(unit))return{amount,kind:"volume" as const,base:amount,label:"tsp"};
  if(/^(?:no|nos|piece|pieces|pc|pcs|clove|cloves|sprig|sprigs|cube|cubes|slice|slices)$/.test(unit))return{amount,kind:"count" as const,base:amount,label:""};
  return{amount,kind:`unit:${unit}` as const,base:amount,label:unit};
}
function formatGroceryNumber(value:number){
  const rounded=Math.round(value*100)/100;
  return Number.isInteger(rounded)?String(rounded):String(rounded).replace(/\.00$/,"").replace(/(\.\d*[1-9])0+$/,"$1");
}
function mergeGroceryQuantities(values:string[]){
  const cleaned=values.map(cleanGroceryQuantity).filter(Boolean);
  if(!cleaned.length)return"";
  const parsed=cleaned.map(groceryMeasurement);
  const valid=parsed.filter((item):item is NonNullable<ReturnType<typeof groceryMeasurement>>=>Boolean(item));
  if(!valid.length)return"";
  const kinds=[...new Set(valid.map(item=>item.kind))];
  if(kinds.length===1){
    const kind=kinds[0],total=valid.reduce((sum,item)=>sum+item.base,0);
    if(kind==="count")return formatGroceryNumber(total);
    if(kind==="weight"){
      const pounds=Math.floor(total/16),ounces=Math.round((total-pounds*16)*100)/100;
      return pounds&&ounces?`${pounds} lb ${formatGroceryNumber(ounces)} oz`:pounds?`${pounds} lb`:`${formatGroceryNumber(ounces)} oz`;
    }
    if(kind==="metric-weight")return total>=1000?`${formatGroceryNumber(total/1000)} kg`:`${formatGroceryNumber(total)} g`;
    if(kind==="volume"){
      const cups=Math.floor(total/48),afterCups=total-cups*48,tbsp=Math.floor(afterCups/3),tsp=Math.round((afterCups-tbsp*3)*100)/100;
      return[cups?`${cups} cup${cups===1?"":"s"}`:"",tbsp?`${tbsp} tbsp`:"",tsp?`${formatGroceryNumber(tsp)} tsp`:""].filter(Boolean).join(" ");
    }
    return`${formatGroceryNumber(total)} ${valid[0].label}`.trim();
  }
  const byKind=new Map<string,NonNullable<ReturnType<typeof groceryMeasurement>>[]>();
  for(const measurement of valid)byKind.set(measurement.kind,[...(byKind.get(measurement.kind)??[]),measurement]);
  return[...byKind.values()].map(group=>{
    const sample=group[0],total=group.reduce((sum,item)=>sum+item.base,0);
    if(sample.kind==="count")return formatGroceryNumber(total);
    if(sample.kind==="weight"){const pounds=Math.floor(total/16),ounces=Math.round((total-pounds*16)*100)/100;return pounds&&ounces?`${pounds} lb ${formatGroceryNumber(ounces)} oz`:pounds?`${pounds} lb`:`${formatGroceryNumber(ounces)} oz`}
    if(sample.kind==="metric-weight")return total>=1000?`${formatGroceryNumber(total/1000)} kg`:`${formatGroceryNumber(total)} g`;
    if(sample.kind==="volume"){const cups=Math.floor(total/48),afterCups=total-cups*48,tbsp=Math.floor(afterCups/3),tsp=Math.round((afterCups-tbsp*3)*100)/100;return[cups?`${cups} cup${cups===1?"":"s"}`:"",tbsp?`${tbsp} tbsp`:"",tsp?`${formatGroceryNumber(tsp)} tsp`:""].filter(Boolean).join(" ")}
    return`${formatGroceryNumber(total)} ${sample.label}`.trim();
  }).join(" + ");
}
function buildLocalGrocerySummary(menuItems:GroceryListMenuItem[]){
  const groups=new Map<string,{item:string;quantities:string[];usedBy:Set<string>}>();
  for(const menuItem of menuItems){
    if(menuItem.recipeMissing)continue;
    const usedBy=`${menuItem.schedule} — ${menuItem.title}`;
    for(const rawIngredient of menuItem.ingredients){
      for(const expanded of expandCompoundGroceryIngredient(rawIngredient)){
        const split=splitGroceryItemQuantity(expanded);
        const canonical=canonicalGroceryItem(split.item);
        if(!canonical)continue;
        const key=canonical.toLowerCase();
        const current=groups.get(key)??{item:canonical,quantities:[],usedBy:new Set<string>()};
        if(split.quantity)current.quantities.push(split.quantity);
        current.usedBy.add(usedBy);
        groups.set(key,current);
      }
    }
  }
  return[...groups.values()]
    .map(group=>({item:group.item,quantity:mergeGroceryQuantities(group.quantities),usedBy:[...group.usedBy]}))
    .sort((a,b)=>a.item.localeCompare(b.item));
}
function finalClientGroceryDedupe(summary:GrocerySummaryItem[]){
  const groups=new Map<string,{item:string;quantities:string[];usedBy:Set<string>}>();
  for(const row of summary){
    const canonical=canonicalGroceryItem(row.item);
    if(!canonical)continue;
    const key=canonical.toLowerCase();
    const current=groups.get(key)??{item:canonical,quantities:[],usedBy:new Set<string>()};
    const quantity=cleanGroceryQuantity(row.quantity).replace(/^as listed in recipes$/i,"").trim();
    if(quantity)current.quantities.push(quantity);
    for(const usedBy of row.usedBy??[])if(usedBy?.trim())current.usedBy.add(usedBy.trim());
    groups.set(key,current);
  }
  return[...groups.values()].map(group=>{
    const merged=mergeGroceryQuantities(group.quantities);
    const fallback=group.quantities.some(value=>/^see recipes$/i.test(value))?"See recipes":group.quantities.length>1?"See recipes":group.quantities[0]??"";
    return{item:group.item,quantity:merged||fallback,usedBy:[...group.usedBy]};
  }).sort((a,b)=>a.item.localeCompare(b.item));
}

function WeeklyMenuThumb({item}:{item:WeeklyMenuItem}){
  const[thumbnail,setThumbnail]=useState<string|null>(null),[failed,setFailed]=useState(false);
  useEffect(()=>{let active=true;setThumbnail(null);setFailed(false);fetch(`/api/thumbnail?url=${encodeURIComponent(item.url)}`).then(r=>r.ok?r.json():Promise.reject()).then((data:{thumbnail?:string})=>{if(active&&data.thumbnail)setThumbnail(data.thumbnail)}).catch(()=>{if(active)setFailed(true)});return()=>{active=false}},[item.url]);
  return <div className={`weekly-thumb ${thumbnail&&!failed?"has-image":""}`}>{thumbnail&&!failed?<img src={thumbnail} alt="" onError={()=>setFailed(true)}/>:<div className={`weekly-thumb-fallback ${item.source.toLowerCase()}`}><span>▶</span><small>{item.source}</small></div>}<span className="weekly-thumb-play">▶</span></div>
}

function WeeklyMenuPlanner({videos,onClose,onRecipeSaved,onOpenRecipe}:{videos:Video[];onClose:()=>void;onRecipeSaved:(videoId:string,recipe:Recipe)=>void;onOpenRecipe:(videoId:string)=>void}){
  const[weekStart,setWeekStart]=useState(currentMondayISO()),[items,setItems]=useState<WeeklyMenuItem[]>(()=>generateWeeklyItems(videos)),[savedMenus,setSavedMenus]=useState<SavedWeeklyMenu[]>([]),[activeSavedId,setActiveSavedId]=useState(""),[menuName,setMenuName]=useState(""),[status,setStatus]=useState(""),[loadingSaved,setLoadingSaved]=useState(true),[saving,setSaving]=useState(false),[savedMenuDirty,setSavedMenuDirty]=useState(false),[recipeCheckOpen,setRecipeCheckOpen]=useState(false),[batch,setBatch]=useState<BatchRecipeState>({running:false,total:0,completed:0,success:0,failed:0,currentIds:[],failures:[]}),[groceryLoading,setGroceryLoading]=useState(false),[groceryList,setGroceryList]=useState<GroceryListResult|null>(null),[manualRecipeVideoId,setManualRecipeVideoId]=useState<string|null>(null),[manualRecipeDraft,setManualRecipeDraft]=useState<RecipeDraft|null>(null),[manualRecipeSaving,setManualRecipeSaving]=useState(false),[singleRetryId,setSingleRetryId]=useState<string|null>(null);
  const batchStopRef=useRef(false);
  const batchRunningRef=useRef(false);
  const batchRunIdRef=useRef(0);
  const batchCompletedIdsRef=useRef<Set<string>>(new Set());
  const foodCount=videos.filter(v=>v.status==="available"&&v.category.toLowerCase()==="food").length;
  const menuVideos=useMemo(()=>{const seen=new Set<string>();return items.flatMap(item=>{if(seen.has(item.videoId))return[];const video=videos.find(v=>v.id===item.videoId);if(!video)return[];seen.add(item.videoId);return[video]})},[items,videos]);
  const missingRecipeVideos=menuVideos.filter(video=>!video.recipe),recipeReadyCount=menuVideos.length-missingRecipeVideos.length,allRecipesReady=menuVideos.length>0&&!missingRecipeVideos.length;

  useEffect(()=>{let active=true;(async()=>{try{const response=await fetch("/api/weekly-menus",{cache:"no-store"});if(response.status===401){location.href="/sign-in";return}if(!response.ok)throw new Error();const data=await response.json() as {menus?:SavedWeeklyMenu[]};if(active)setSavedMenus(Array.isArray(data.menus)?data.menus:[])}catch{if(active)setStatus("Saved menus are temporarily unavailable.")}finally{if(active)setLoadingSaved(false)}})();return()=>{active=false}},[]);

  function resetDerived(){batchStopRef.current=true;batchRunIdRef.current+=1;batchRunningRef.current=false;batchCompletedIdsRef.current=new Set();setRecipeCheckOpen(false);setGroceryList(null);setBatch({running:false,total:0,completed:0,success:0,failed:0,currentIds:[],failures:[]})}
  function regenerate(){setItems(generateWeeklyItems(videos));setActiveSavedId("");setMenuName("");setSavedMenuDirty(false);resetDerived();setStatus(foodCount?"New weekly menu generated.":"Add Food videos before generating a weekly menu.")}
  function moveWeek(delta:number){setWeekStart(current=>shiftWeekISO(current,delta));setItems(generateWeeklyItems(videos));setActiveSavedId("");setMenuName("");setSavedMenuDirty(false);resetDerived()}
  function reroll(day:string,slot:WeeklyMenuSlot){const current=items.find(item=>item.day===day&&item.slot===slot),used=new Set(items.filter(item=>item!==current).map(item=>item.videoId));const video=chooseWeeklyVideo(videos,slot,used);if(!video){setStatus(`No matching Food videos are available for ${slot}.`);return}const next=menuItemFromVideo(day,slot,video);setItems(existing=>[...existing.filter(item=>!(item.day===day&&item.slot===slot)),next]);if(activeSavedId){setSavedMenuDirty(true);setStatus("Menu item replaced. Use Overwrite Saved Menu to update the saved menu.")}else setStatus(`${slot} replaced for ${day}.`);resetDerived()}
  async function persist(next:SavedWeeklyMenu[],message:string){setSaving(true);try{const response=await fetch("/api/weekly-menus",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({menus:next})});if(response.status===401){location.href="/sign-in";return false}if(!response.ok)throw new Error();setSavedMenus(next);setStatus(message);return true}catch{setStatus("Could not save the weekly menu. Please try again.");return false}finally{setSaving(false)}}
  async function saveMenu(){if(!items.length){setStatus("Generate a menu before saving.");return}const now=new Date().toISOString(),defaultName=`Week of ${weekTitle(weekStart)}`,name=menuName.trim()||defaultName;if(activeSavedId){const next=savedMenus.map(menu=>menu.id===activeSavedId?{...menu,name,weekStart,items,updatedAt:now}:menu);if(await persist(next,"Saved menu overwritten with the current menu.")){setMenuName(name);setSavedMenuDirty(false)}return}const menu:SavedWeeklyMenu={id:crypto.randomUUID(),name,weekStart,items,createdAt:now,updatedAt:now};if(await persist([menu,...savedMenus],"Weekly menu saved.")){setActiveSavedId(menu.id);setMenuName(name);setSavedMenuDirty(false);setRecipeCheckOpen(false)}}
  function loadMenu(id:string){const menu=savedMenus.find(item=>item.id===id);if(!menu)return;setActiveSavedId(menu.id);setMenuName(menu.name);setWeekStart(menu.weekStart);setItems(menu.items);setSavedMenuDirty(false);resetDerived();setStatus(`Loaded ${menu.name}.`)}
  async function deleteMenu(){if(!activeSavedId)return;const current=savedMenus.find(menu=>menu.id===activeSavedId);if(!current||!confirm(`Delete saved menu "${current.name}"?`))return;const next=savedMenus.filter(menu=>menu.id!==activeSavedId);if(await persist(next,"Saved menu deleted.")){setActiveSavedId("");setMenuName("");setSavedMenuDirty(false);resetDerived()}}

  function checkRecipes(){if(!activeSavedId){setStatus("Save the weekly menu first, then check recipe readiness.");return}setRecipeCheckOpen(true);setStatus(missingRecipeVideos.length?`${missingRecipeVideos.length} unique menu video${missingRecipeVideos.length===1?" is":"s are"} missing a recipe.`:"Every menu video has a recipe. Grocery List is ready.")}

  async function analyzeMissingRecipes(){
    if(batchRunningRef.current){setStatus("Batch recipe analysis is already running.");return}
    if(!activeSavedId){setStatus("Save the weekly menu before batch analysis.");return}

    const queue=[...new Map(missingRecipeVideos.map(video=>[video.id,video] as const)).values()];
    if(!queue.length){setRecipeCheckOpen(true);setStatus("Every menu video already has a recipe.");return}

    batchRunningRef.current=true;
    batchStopRef.current=false;
    batchCompletedIdsRef.current=new Set();
    const runId=++batchRunIdRef.current;

    setRecipeCheckOpen(true);
    setGroceryList(null);
    setBatch({running:true,total:queue.length,completed:0,success:0,failed:0,currentIds:[],failures:[]});
    setStatus("Batch recipe analysis started. You can continue viewing the weekly menu while it runs.");

    let nextIndex=0;

    const finishVideo=(video:Video,ok:boolean,error:string)=>{
      if(runId!==batchRunIdRef.current)return;
      if(batchCompletedIdsRef.current.has(video.id))return;

      batchCompletedIdsRef.current.add(video.id);

      setBatch(current=>{
        const completed=Math.min(current.total,current.completed+1);
        const success=Math.min(current.total,current.success+(ok?1:0));
        const failed=Math.min(current.total,current.failed+(ok?0:1));
        const failures=ok||current.failures.some(item=>item.videoId===video.id)
          ? current.failures
          : [...current.failures,{videoId:video.id,title:video.title,error}];

        return{
          ...current,
          completed,
          success,
          failed,
          currentIds:current.currentIds.filter(id=>id!==video.id),
          failures
        };
      });
    };

    const worker=async()=>{
      while(true){
        if(batchStopRef.current||runId!==batchRunIdRef.current)return;

        const index=nextIndex++;
        if(index>=queue.length)return;

        const video=queue[index];

        setBatch(current=>({
          ...current,
          currentIds:current.currentIds.includes(video.id)
            ? current.currentIds
            : [...current.currentIds,video.id]
        }));

        let ok=false,error="";

        try{
          const response=await fetch("/api/reel-video-recipe",{
            method:"POST",
            headers:{"Content-Type":"application/json"},
            body:JSON.stringify({video:{url:video.url,title:video.title,notes:video.notes,source:video.source}})
          });

          const result=await response.json() as {
            analysis?:{message?:string;error?:string};
            recipe?:Recipe|null;
            error?:string;
            message?:string;
            descriptionFound?:boolean
          };

          if(result.recipe){
            if(runId===batchRunIdRef.current)onRecipeSaved(video.id,result.recipe);
            ok=true;
          }else{
            error=result.analysis?.error||result.error||result.analysis?.message||result.message||`No reliable recipe was generated (HTTP ${response.status}).`;
          }
        }catch(err){
          error=err instanceof Error?err.message:"Analysis request failed";
        }

        finishVideo(video,ok,error);
        await new Promise<void>(resolve=>window.setTimeout(resolve,25));
      }
    };

    try{
      const workers=Array.from({length:Math.min(2,queue.length)},()=>worker());
      await Promise.all(workers);
    }finally{
      if(runId===batchRunIdRef.current){
        batchRunningRef.current=false;
        setBatch(current=>({
          ...current,
          running:false,
          completed:Math.min(current.completed,current.total),
          success:Math.min(current.success,current.total),
          failed:Math.min(current.failed,current.total),
          currentIds:[]
        }));
        setStatus(batchStopRef.current?"Batch analysis stopped after the current requests.":"Batch recipe analysis finished. Review any failures below.");
      }
    }
  }

  async function retryWeeklyRecipe(videoId:string,mode:RetryMode="auto"){
    const video=videos.find(item=>item.id===videoId);if(!video||singleRetryId||batch.running)return;
    const modeLabel=mode==="audio"?"Audio":mode==="video"?"Video":"Auto";
    setSingleRetryId(video.id);setStatus(`${modeLabel} retry for ${video.title}… This retry will stop automatically after 75 seconds.`);
    try{
      const response=await fetchWithWeeklyRetryTimeout("/api/reel-video-recipe",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({video:{url:video.url,title:video.title,notes:video.notes,source:video.source},retryMode:mode})});
      const result=await response.json() as {analysis?:{message?:string;error?:string};recipe?:Recipe|null;error?:string;message?:string;descriptionFound?:boolean};
      if(result.recipe){onRecipeSaved(video.id,result.recipe);setBatch(current=>({...current,success:current.success+1,failed:Math.max(0,current.failed-(current.failures.some(item=>item.videoId===video.id)?1:0)),failures:current.failures.filter(item=>item.videoId!==video.id)}));setStatus(`${modeLabel} retry added a recipe for ${video.title}.`)}
      else{const error=result.analysis?.error||result.error||result.analysis?.message||result.message||`No reliable recipe was generated (HTTP ${response.status}).`;setBatch(current=>({...current,failures:current.failures.some(item=>item.videoId===video.id)?current.failures.map(item=>item.videoId===video.id?{...item,error}:item):[...current.failures,{videoId:video.id,title:video.title,error}]}));setStatus(`${modeLabel} retry still could not build a recipe for ${video.title}. Try another mode or add it manually.`)}
    }catch(err){const timedOut=err instanceof DOMException&&err.name==="AbortError";
      const error=timedOut
        ?"Retry timed out after 75 seconds. The reel service did not return quickly enough."
        :err instanceof Error?err.message:"Analysis request failed";setBatch(current=>({...current,failures:current.failures.some(item=>item.videoId===video.id)?current.failures.map(item=>item.videoId===video.id?{...item,error}:item):[...current.failures,{videoId:video.id,title:video.title,error}]}));setStatus(`${modeLabel} retry failed for ${video.title}. Try another mode or add the recipe manually.`)}
    finally{setSingleRetryId(null)}
  }

  function openWeeklyRecipeEditor(videoId:string){
    const video=videos.find(item=>item.id===videoId);
    if(!video)return;

    const recipe=video.recipe;
    setManualRecipeVideoId(videoId);
    setManualRecipeDraft({
      title:recipe?.title||video.title,
      servings:recipe?.servings||"",
      prepTime:recipe?.prepTime||"",
      ingredients:(recipe?.ingredients??[]).join("\n"),
      steps:(recipe?.steps??[]).join("\n"),
      notes:recipe?.notes||""
    });
  }

  function closeWeeklyRecipeEditor(){
    setManualRecipeVideoId(null);
    setManualRecipeDraft(null);
    setManualRecipeSaving(false);
  }

  function saveWeeklyManualRecipe(){
    const video=videos.find(item=>item.id===manualRecipeVideoId);
    if(!video||!manualRecipeDraft)return;

    const ingredients=manualRecipeDraft.ingredients
      .split("\n")
      .map(item=>item.trim())
      .filter(Boolean);

    const steps=manualRecipeDraft.steps
      .split("\n")
      .map(item=>item.trim())
      .filter(Boolean);

    if(!ingredients.length){
      setStatus("Add at least one ingredient before saving the recipe.");
      return;
    }

    setManualRecipeSaving(true);

    const updated:Recipe={source:"manual",
      title:manualRecipeDraft.title.trim()||video.title,
      ingredients,
      steps,
      notes:manualRecipeDraft.notes.trim(),
      servings:manualRecipeDraft.servings.trim(),
      prepTime:manualRecipeDraft.prepTime.trim(),
      extractedAt:video.recipe?.extractedAt||new Date().toISOString(),
      ...(video.recipe?.evidence?.length?{evidence:video.recipe.evidence}:{})
    };

    const wasFailure=batch.failures.some(item=>item.videoId===video.id);

    onRecipeSaved(video.id,updated);

    if(wasFailure){
      setBatch(current=>({
        ...current,
        success:Math.min(current.total,current.success+1),
        failed:Math.max(0,current.failed-1),
        failures:current.failures.filter(item=>item.videoId!==video.id)
      }));
    }

    setStatus(`${video.recipe?"Recipe changes":"Manual recipe"} saved for ${video.title}.`);
    closeWeeklyRecipeEditor();
  }

  async function generateGroceryList(){
    if(!activeSavedId){setStatus("Save the weekly menu first.");return}
    setGroceryLoading(true);
    try{
      const menuItems:GroceryListMenuItem[]=items.map(item=>{
        const video=videos.find(v=>v.id===item.videoId),recipe=video?.recipe??null;
        return{schedule:`${item.day} · ${item.slot}`,videoId:item.videoId,title:recipe?.title||video?.title||item.title,ingredients:recipe?.ingredients??[],recipeMissing:!recipe};
      });
      const response=await fetch("/api/grocery-list",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({menuItems})});
      if(response.status===401){location.href="/sign-in";return}
      if(!response.ok)throw new Error(`Grocery API returned HTTP ${response.status}`);
      const result=await response.json() as {menuItems?:GroceryListMenuItem[];summary?:GrocerySummaryItem[];generatedAt?:string};
      const apiSummary=Array.isArray(result.summary)?finalClientGroceryDedupe(result.summary):[];
      const localFallback=finalClientGroceryDedupe(buildLocalGrocerySummary(menuItems));
      const summary=apiSummary.length?apiSummary:localFallback;
      const finalMenuItems=Array.isArray(result.menuItems)&&result.menuItems.length?result.menuItems:menuItems;
      const generatedAt=result.generatedAt||new Date().toISOString();
      const missingCount=finalMenuItems.filter(item=>item.recipeMissing).length;
      setGroceryList({menuItems:finalMenuItems,summary,aisleGroups:groupGrocerySummaryByAisle(summary),generatedAt});
      setStatus(missingCount?`Grocery list generated. ${missingCount} menu item${missingCount===1?" is":"s are"} missing recipes and are clearly marked.`:"Weekly grocery list generated.");
    }catch{setStatus("Could not generate the grocery list. Please try again.")}finally{setGroceryLoading(false)}
  }
  async function copyGroceryList(){
    if(!groceryList)return;
    const text=["Weekly Grocery List","",...groceryList.menuItems.flatMap(item=>[`${item.schedule} — ${item.title}`,...(item.recipeMissing?["  • Recipe missing — ingredients unavailable"]:item.ingredients.map(ingredient=>`  • ${ingredient}`)),""]),"SHOPPING SUMMARY BY AISLE","",...groceryList.aisleGroups.flatMap(group=>[group.aisle,...group.items.map(item=>`  • ${item.item}${item.quantity?` — ${item.quantity}`:""}`),""])].join("\n");
    try{await navigator.clipboard.writeText(text);setStatus("Grocery list copied.")}catch{setStatus("Could not copy the grocery list.")}
  }

  const progress=batch.total?Math.min(100,Math.round(batch.completed/batch.total*100)):0;

  return <div className="dialog weekly-menu-dialog">
    <button className="dialog-close" onClick={onClose}>×</button>
    <div className="weekly-menu-heading"><div><p className="kicker">WEEKLY MENU</p><h2>Plan the week from your saved Food reels</h2><p>Random selections use your Food videos and avoid repeats when enough matching videos are available.</p></div><div className="weekly-menu-count"><strong>{foodCount}</strong><span>Food videos</span></div></div>
    <div className="weekly-menu-controls"><div className="week-switcher"><button type="button" onClick={()=>moveWeek(-1)}>‹</button><strong>{weekTitle(weekStart)}</strong><button type="button" onClick={()=>moveWeek(1)}>›</button><button type="button" onClick={()=>{setWeekStart(currentMondayISO());setItems(generateWeeklyItems(videos));setActiveSavedId("");setMenuName("");setSavedMenuDirty(false);resetDerived()}}>This week</button></div><button type="button" onClick={regenerate} disabled={!foodCount}>⤨ Regenerate Week</button></div>
    <div className="weekly-menu-savebar"><input value={menuName} onChange={e=>{setMenuName(e.target.value);if(activeSavedId)setSavedMenuDirty(true)}} placeholder={`Week of ${weekTitle(weekStart)}`} aria-label="Weekly menu name"/><button type="button" className="primary" onClick={()=>void saveMenu()} disabled={saving||!items.length||(Boolean(activeSavedId)&&!savedMenuDirty)}>{saving?"Saving…":activeSavedId?(savedMenuDirty?"Overwrite Saved Menu":"Saved Menu"):"Save Menu"}</button><select value={activeSavedId} onChange={e=>e.target.value?loadMenu(e.target.value):(setActiveSavedId(""),setMenuName(""),setSavedMenuDirty(false),resetDerived())} disabled={loadingSaved}><option value="">{loadingSaved?"Loading saved menus…":"Saved menus…"}</option>{savedMenus.map(menu=><option key={menu.id} value={menu.id}>{menu.name}</option>)}</select>{activeSavedId?<button type="button" className="danger" onClick={()=>void deleteMenu()} disabled={saving}>Delete Saved</button>:null}</div>
    {activeSavedId?<div className="weekly-recipe-readiness"><div><p className="kicker">RECIPE READINESS</p><strong>{recipeReadyCount} of {menuVideos.length} unique menu videos have recipes</strong><small>{allRecipesReady?"Everything is ready for a grocery list.":"Grocery List is available now; items without recipes will be marked as missing."}</small></div><div className="weekly-readiness-actions"><button type="button" onClick={checkRecipes}>Check Recipes</button>{recipeCheckOpen&&missingRecipeVideos.length?<button type="button" className="primary" onClick={()=>void analyzeMissingRecipes()} disabled={batch.running}>🎥 Analyze Missing ({missingRecipeVideos.length})</button>:null}<button type="button" className="grocery-action" onClick={()=>void generateGroceryList()} disabled={groceryLoading}>{groceryLoading?"Building list…":"🛒 Generate Grocery List"}</button></div></div>:null}
    {recipeCheckOpen&&missingRecipeVideos.length&&!batch.running?<div className="weekly-missing-recipes"><strong>Missing recipes</strong><div className="weekly-missing-recipe-list">{missingRecipeVideos.map(video=><div className="weekly-missing-recipe-row" key={video.id}><span>{video.title}</span><div><button type="button" title="Use all available evidence" onClick={()=>void retryWeeklyRecipe(video.id,"auto")} disabled={singleRetryId!==null}>{singleRetryId===video.id?"Retrying…":"✨ Auto"}</button><button type="button" title="Prioritize spoken narration / transcript" onClick={()=>void retryWeeklyRecipe(video.id,"audio")} disabled={singleRetryId!==null}>🎙 Audio</button><button type="button" title="Prioritize on-screen ingredients / OCR" onClick={()=>void retryWeeklyRecipe(video.id,"video")} disabled={singleRetryId!==null}>👁 Video</button><button type="button" className="manual" onClick={()=>openWeeklyRecipeEditor(video.id)}>✎ Add Recipe</button></div></div>)}</div></div>:null}
    {batch.running||batch.total?<div className="weekly-batch-progress"><div className="weekly-batch-top"><div><strong>{batch.running?"Batch analysis running":"Batch analysis complete"}</strong><small>{batch.completed} of {batch.total} analyzed · {batch.success} recipes added · {batch.failed} failed</small></div>{batch.running?<button type="button" onClick={()=>{batchStopRef.current=true;setStatus("Stopping after the current requests finish…")}}>Stop after current</button>:null}</div><div className="weekly-progress-track"><span style={{width:`${progress}%`}}/></div>{batch.currentIds.length?<div className="weekly-current-batch"><span>Analyzing now:</span>{batch.currentIds.map(id=><strong key={id}>{videos.find(v=>v.id===id)?.title??"Video"}</strong>)}</div>:null}{batch.failures.filter(item=>!videos.find(video=>video.id===item.videoId)?.recipe).length?<details className="weekly-batch-failures" open><summary>{batch.failures.filter(item=>!videos.find(video=>video.id===item.videoId)?.recipe).length} item{batch.failures.filter(item=>!videos.find(video=>video.id===item.videoId)?.recipe).length===1?"":"s"} need attention</summary>{batch.failures.filter(item=>!videos.find(video=>video.id===item.videoId)?.recipe).map(item=><div key={item.videoId}><strong>{item.title}</strong><small>{item.error}</small><div className="weekly-failure-actions"><button type="button" title="Use all available evidence" onClick={()=>void retryWeeklyRecipe(item.videoId,"auto")} disabled={singleRetryId!==null||batch.running}>{singleRetryId===item.videoId?"Retrying…":"✨ Auto"}</button><button type="button" title="Prioritize spoken narration / transcript" onClick={()=>void retryWeeklyRecipe(item.videoId,"audio")} disabled={singleRetryId!==null||batch.running}>🎙 Audio</button><button type="button" title="Prioritize on-screen ingredients / OCR" onClick={()=>void retryWeeklyRecipe(item.videoId,"video")} disabled={singleRetryId!==null||batch.running}>👁 Video</button><button type="button" className="manual" onClick={()=>openWeeklyRecipeEditor(item.videoId)}>✎ Add Recipe</button></div></div>)}</details>:null}</div>:null}
    {status?<div className="weekly-menu-status">{status}</div>:null}
    {!foodCount?<div className="weekly-menu-empty"><strong>No Food videos yet</strong><span>Classify or move videos into Food, then generate the weekly menu.</span></div>:<div className="weekly-menu-scroll"><div className="weekly-calendar weekly-calendar-matrix"><div className="weekly-calendar-header-row"><div className="weekly-day-column-title"><span>Day</span></div>{WEEKLY_MENU_SLOTS.map(slot=><div className="weekly-meal-column-title" key={slot}><span>{slot}</span></div>)}</div>{WEEKLY_MENU_DAYS.map((day,dayIndex)=><div className="weekly-calendar-row" key={day}><div className="weekly-day-cell"><strong>{day}</strong><small>{dayDateLabel(weekStart,dayIndex)}</small></div>{WEEKLY_MENU_SLOTS.map(slot=>{const item=items.find(menuItem=>menuItem.day===day&&menuItem.slot===slot),liveVideo=item?videos.find(v=>v.id===item.videoId):null;return <div className="weekly-meal-cell" key={slot}><button className="weekly-reroll" type="button" title={`Choose another ${slot}`} aria-label={`Choose another ${slot} for ${day}`} onClick={()=>reroll(day,slot)}>↻</button>{item?<div className="weekly-video-card-shell"><a className="weekly-video-card" href={item.url} target="_blank" rel="noreferrer"><WeeklyMenuThumb item={item}/><div className="weekly-video-card-copy"><strong>{item.title}</strong><small>{item.subcategory||item.source}</small></div></a>{liveVideo?.recipe?<button type="button" className="weekly-recipe-note" title="View recipe" aria-label={`View recipe for ${item.title}`} onClick={()=>onOpenRecipe(item.videoId)}>🗒</button>:liveVideo?<button type="button" className="weekly-manual-recipe" title="Add recipe manually" aria-label={`Add recipe manually for ${item.title}`} onClick={()=>openWeeklyRecipeEditor(item.videoId)}>✎</button>:null}</div>:<div className="weekly-no-video"><span>No matching</span><strong>{slot}</strong></div>}</div>})}</div>)}</div></div>}
    <div className="weekly-menu-footer"><small>🗒 marks saved recipes; ✎ lets you add a missing recipe manually. Failed items can retry using Auto, Audio, or Video. Replacing an item in a loaded saved menu enables Overwrite Saved Menu.</small><button type="button" onClick={onClose}>Close</button></div>
    {manualRecipeVideoId&&manualRecipeDraft?<div className="weekly-manual-recipe-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)closeWeeklyRecipeEditor()}}><div className="weekly-manual-recipe-panel"><button className="dialog-close" onClick={closeWeeklyRecipeEditor}>×</button><p className="kicker">{videos.find(video=>video.id===manualRecipeVideoId)?.recipe?"EDIT RECIPE":"ADD RECIPE MANUALLY"}</p><h2>{videos.find(video=>video.id===manualRecipeVideoId)?.title??"Recipe"}</h2><p className="weekly-manual-recipe-intro">Enter or correct the recipe here. Saving returns you to the same Weekly Menu and immediately updates recipe readiness.</p><div className="recipe-edit-form"><label>Recipe title<input value={manualRecipeDraft.title} onChange={e=>setManualRecipeDraft({...manualRecipeDraft,title:e.target.value})}/></label><div className="form-row"><label>Servings<input value={manualRecipeDraft.servings} onChange={e=>setManualRecipeDraft({...manualRecipeDraft,servings:e.target.value})}/></label><label>Prep / cooking time<input value={manualRecipeDraft.prepTime} onChange={e=>setManualRecipeDraft({...manualRecipeDraft,prepTime:e.target.value})}/></label></div><label>Ingredients <small>One ingredient per line · required for Grocery List</small><textarea rows={10} value={manualRecipeDraft.ingredients} onChange={e=>setManualRecipeDraft({...manualRecipeDraft,ingredients:e.target.value})} placeholder={"1 lb chicken\n1 cup yogurt\n2 tbsp spice mix"}/></label><label>Steps <small>One step per line</small><textarea rows={9} value={manualRecipeDraft.steps} onChange={e=>setManualRecipeDraft({...manualRecipeDraft,steps:e.target.value})} placeholder={"Marinate the chicken\nCook until done\nServe warm"}/></label><label>Notes<textarea rows={4} value={manualRecipeDraft.notes} onChange={e=>setManualRecipeDraft({...manualRecipeDraft,notes:e.target.value})}/></label><div className="analysis-actions"><button type="button" className="primary" onClick={saveWeeklyManualRecipe} disabled={manualRecipeSaving}>{manualRecipeSaving?"Saving…":"Save Recipe"}</button><button type="button" onClick={closeWeeklyRecipeEditor}>Cancel</button><a href={videos.find(video=>video.id===manualRecipeVideoId)?.url} target="_blank" rel="noreferrer">Open original ↗</a></div></div></div></div>:null}
    {groceryList?<div className="weekly-grocery-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setGroceryList(null)}}><div className="weekly-grocery-panel"><button className="dialog-close" onClick={()=>setGroceryList(null)}>×</button><p className="kicker">WEEKLY GROCERY LIST</p><h2>{menuName||`Week of ${weekTitle(weekStart)}`}</h2><p className="weekly-grocery-intro">Every scheduled menu item is listed. Items without a saved recipe are marked as missing; known ingredients are consolidated below by grocery aisle.</p><div className="weekly-grocery-items">{groceryList.menuItems.map((item,index)=><section key={`${item.videoId}-${index}`}><div><strong>{item.schedule}</strong><span>{item.title}</span></div>{item.recipeMissing?<p><strong>Recipe missing</strong> — ingredients unavailable</p>:<ul>{item.ingredients.map((ingredient,i)=><li key={`${i}-${ingredient}`}>{ingredient}</li>)}</ul>}</section>)}</div><section className="weekly-grocery-summary"><h3>Shopping summary by aisle</h3>{groceryList.aisleGroups.length?groceryList.aisleGroups.map(group=><div key={group.aisle}><h4>{group.aisle}</h4><ul>{group.items.map((item,index)=><li key={`${group.aisle}-${index}-${item.item}`}><div><strong>{item.item}</strong>{item.quantity?<span>{item.quantity}</span>:null}</div>{item.usedBy.length?<small>Used by: {item.usedBy.join(", ")}</small>:null}</li>)}</ul></div>):<p>No ingredient summary is available yet because the menu recipes are missing.</p>}</section><div className="analysis-actions"><button type="button" className="primary" onClick={()=>void copyGroceryList()}>Copy Grocery List</button><button type="button" onClick={()=>void generateGroceryList()} disabled={groceryLoading}>{groceryLoading?"Refreshing…":"Regenerate"}</button><button type="button" onClick={()=>setGroceryList(null)}>Close</button></div></div></div>:null}
  </div>
}

export default function Home(){
  const[recipeAuditOpen,setRecipeAuditOpen]=useState(false);
  const[recipeAudit,setRecipeAudit]=useState<{running:boolean;total:number;completed:number;upgraded:number;added:number;kept:number;protected:number;failed:number;currentIds:string[];items:RecipeAuditItem[]}>({running:false,total:0,completed:0,upgraded:0,added:0,kept:0,protected:0,failed:0,currentIds:[],items:[]});
  const recipeAuditStopRef=useRef(false);
  const recipeAuditRunningRef=useRef(false);

  const[recipeEditing,setRecipeEditing]=useState(false),[recipeDraft,setRecipeDraft]=useState<RecipeDraft|null>(null);
  const[weeklyMenuOpen,setWeeklyMenuOpen]=useState(false);
  const[videoAnalysisResult,setVideoAnalysisResult]=useState<ReelAnalysisResult|null>(null);
  const[videoAnalysisOpen,setVideoAnalysisOpen]=useState(false);
  const[videoAnalysisId,setVideoAnalysisId]=useState<string|null>(null),[videoAnalysisBusy,setVideoAnalysisBusy]=useState(false),[videoAnalysisStage,setVideoAnalysisStage]=useState("");
  const[recipeVideoId,setRecipeVideoId]=useState<string|null>(null),[recipeLoadingId,setRecipeLoadingId]=useState<string|null>(null),[recipePasteVideoId,setRecipePasteVideoId]=useState<string|null>(null),[recipePasteText,setRecipePasteText]=useState("");
  const[videos,setVideos]=useState<Video[]>([]),[categories,setCategories]=useState<Category[]>(DEFAULT_CATEGORIES),[ready,setReady]=useState(false),[query,setQuery]=useState(""),[category,setCategory]=useState("All"),[expandedCategory,setExpandedCategory]=useState(""),[subcategory,setSubcategory]=useState(""),[favorites,setFavorites]=useState(false),[showArchive,setShowArchive]=useState(false),[form,setForm]=useState<VideoForm>(EMPTY_FORM),[editingId,setEditingId]=useState<string|null>(null),[dialogOpen,setDialogOpen]=useState(false),[managerOpen,setManagerOpen]=useState(false),[settingsOpen,setSettingsOpen]=useState(false),[clearStep,setClearStep]=useState<0|1|2>(0),[newCategory,setNewCategory]=useState(""),[newSubs,setNewSubs]=useState<Record<string,string>>({}),[playingId,setPlayingId]=useState<string|null>(null),[aiRunning,setAiRunning]=useState(false),[aiProgress,setAiProgress]=useState(""),[toast,setToast]=useState("");const fileRef=useRef<HTMLInputElement>(null),shareHandledRef=useRef(false),aiRunRef=useRef(false);
  useEffect(()=>{let active=true;(async()=>{let localVideos:Video[]=[],localCategories:Category[]=DEFAULT_CATEGORIES;try{const saved=localStorage.getItem(STORAGE_KEY),savedCats=localStorage.getItem(CATEGORY_KEY);if(saved)localVideos=normalizeStoredVideos(JSON.parse(saved));if(savedCats)localCategories=JSON.parse(savedCats)}catch{}try{const response=await fetch("/api/library",{cache:"no-store"});if(response.status===401){location.href="/sign-in";return}if(!response.ok)throw new Error();const result=await response.json() as {exists:boolean;data?:{videos?:Partial<Video>[];categories?:Category[]}};if(!active)return;if(result.exists&&result.data){setVideos(normalizeStoredVideos(result.data.videos??[]));setCategories(result.data.categories?.length?result.data.categories:DEFAULT_CATEGORIES)}else{setVideos(localVideos);setCategories(localCategories);if(localVideos.length||localCategories.length)await fetch("/api/library",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({videos:localVideos,categories:localCategories})})}}catch{if(active){setVideos(localVideos);setCategories(localCategories);setToast("Database unavailable—using the local cache")}}finally{if(active)setReady(true)}})();return()=>{active=false}},[]);
  useEffect(()=>{if(!ready)return;localStorage.setItem(STORAGE_KEY,JSON.stringify(videos));localStorage.setItem(CATEGORY_KEY,JSON.stringify(categories));const timer=window.setTimeout(()=>{fetch("/api/library",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({videos,categories})}).then(response=>{if(response.status===401)location.href="/sign-in"}).catch(()=>{})},500);return()=>window.clearTimeout(timer)},[videos,categories,ready]);useEffect(()=>{if(!toast)return;const t=setTimeout(()=>setToast(""),3200);return()=>clearTimeout(t)},[toast]);
  /* REELRECALL_SHARE_VISIBLE_SAVE_V2 */
  useEffect(()=>{if(!ready||shareHandledRef.current)return;const params=new URLSearchParams(window.location.search),sharedUrl=params.get("shared"),shareError=params.get("shareError");if(!sharedUrl&&!shareError)return;shareHandledRef.current=true;const rawTitle=(params.get("shareTitle")??"").replace(/\s+/g," ").trim(),rawText=(params.get("shareText")??"").trim();window.history.replaceState(null,"",window.location.pathname);if(shareError){setToast("No supported reel link was found in that share");return}const incoming=cleanUrl(sharedUrl??"");if(!incoming)return;void(async()=>{let resolvedUrl=incoming,resolvedIdentity=sharedIdentity(incoming);try{const response=await fetch(`/api/resolve-shared-url?url=${encodeURIComponent(incoming)}`,{cache:"no-store"});if(response.ok){const result=await response.json() as {resolvedUrl?:string;canonicalUrl?:string;identity?:string};resolvedUrl=cleanUrl(result.resolvedUrl||result.canonicalUrl||incoming);resolvedIdentity=result.identity||sharedIdentity(resolvedUrl)}}catch{}const source=sourceFor(resolvedUrl),now=new Date().toISOString();let savedId="",action:"added"|"updated"|"restored"="added";setCategory("All");setExpandedCategory("");setSubcategory("");setFavorites(false);setShowArchive(false);setQuery("");setPlayingId(null);setVideos(current=>{const match=current.find(v=>sharedIdentity(v.url)===resolvedIdentity||canonicalUrl(v.url)===canonicalUrl(resolvedUrl));if(match){savedId=match.id;action=match.status==="unavailable"?"restored":"updated";return[{...match,url:resolvedUrl,source,status:"available" as Status,addedAt:now,aiStatus:match.aiStatus==="failed"?"pending":match.aiStatus},...current.filter(v=>v.id!==match.id)]}const title=rawTitle&&!rawTitle.includes(incoming)&&!rawTitle.includes(resolvedUrl)?rawTitle.slice(0,180):`${source} reel`,notes=rawText.replace(incoming,"").replace(resolvedUrl,"").trim().slice(0,600),video:Video={id:crypto.randomUUID(),title,url:resolvedUrl,category:"Uncategorized",subcategory:"",tags:[],notes,favorite:false,source,addedAt:now,status:"available",titleLocked:false,categoryLocked:false,tagsLocked:false,aiStatus:"pending",recipe:null};savedId=video.id;return[video,...current]});window.setTimeout(()=>{if(action==="restored")setToast("Reel restored to your library");else if(action==="updated")setToast("Reel already existed — refreshed to the top");else setToast(`${source} reel added from Share. Organizing…`);if(savedId)document.querySelector(`[data-video-id="${CSS.escape(savedId)}"]`)?.scrollIntoView({behavior:"smooth",block:"center"})},150)})()},[ready,videos]);
  useEffect(()=>{if(!ready||aiRunning)return;const pending=videos.filter(v=>v.aiStatus==="pending");if(pending.length)void autoCategorize(pending)},[ready,videos,aiRunning]);
  useEffect(()=>{if(!ready)return;let refreshing=false;const refreshSharedVideos=async()=>{if(refreshing||document.visibilityState!=="visible")return;refreshing=true;try{const response=await fetch("/api/library",{cache:"no-store"});if(response.status===401){location.href="/sign-in";return}if(!response.ok)return;const result=await response.json() as {exists:boolean;data?:{videos?:Partial<Video>[];categories?:Category[]}};if(result.exists&&result.data){setVideos(normalizeStoredVideos(result.data.videos??[]));if(result.data.categories?.length)setCategories(result.data.categories)}}finally{refreshing=false}};const onVisible=()=>{if(document.visibilityState==="visible")void refreshSharedVideos()};document.addEventListener("visibilitychange",onVisible);window.addEventListener("focus",onVisible);void refreshSharedVideos();return()=>{document.removeEventListener("visibilitychange",onVisible);window.removeEventListener("focus",onVisible)}},[ready]);
  const formSubs=categories.find(c=>c.name===form.category)?.subcategories??[],filtered=useMemo(()=>{const q=query.toLowerCase().trim();return videos.filter(v=>(showArchive?v.status==="unavailable":v.status==="available")&&(!q||[v.title,v.category,v.subcategory,v.notes,...v.tags,...(v.recipe?.ingredients??[]),...(v.recipe?.steps??[])].join(" ").toLowerCase().includes(q))&&(category==="All"||v.category===category)&&(!subcategory||v.subcategory===subcategory)&&(!favorites||v.favorite)).sort((a,b)=>new Date(b.addedAt).getTime()-new Date(a.addedAt).getTime())},[videos,query,category,subcategory,favorites,showArchive]);
  const chooseCategory=(name:string)=>{setCategory(name);setExpandedCategory(current=>name==="All"?"":current===name?"":name);setSubcategory("");setFavorites(false);setShowArchive(false);setPlayingId(null)},openNew=()=>{setEditingId(null);setForm(EMPTY_FORM);setDialogOpen(true)},openEdit=(v:Video)=>{setPlayingId(null);setEditingId(v.id);setForm({title:v.title,url:v.url,category:v.category,subcategory:v.subcategory,tags:v.tags.join(", "),notes:v.notes,status:v.status});setDialogOpen(true)};
  function saveVideo(e:FormEvent){e.preventDefault();const url=cleanUrl(form.url.trim()),tags=form.tags.split(",").map(t=>t.trim()).filter(Boolean);if(editingId){setVideos(a=>a.map(v=>v.id===editingId?{...v,...form,url,tags,source:sourceFor(url),titleLocked:v.titleLocked||form.title.trim()!==v.title,categoryLocked:true,tagsLocked:true}:v));setToast("Video updated and manual choices locked")}else{if(videos.some(v=>canonicalUrl(v.url)===canonicalUrl(url))){setToast("That video is already in your library");return}setVideos(a=>[{id:crypto.randomUUID(),...form,url,tags,source:sourceFor(url),favorite:false,addedAt:new Date().toISOString(),titleLocked:true,categoryLocked:true,tagsLocked:true,aiStatus:"done"},...a]);setToast("Video added")}setDialogOpen(false)}
  async function autoCategorize(items:Video[]){if(aiRunRef.current)return;const eligible=items.filter(v=>v.status==="available"&&((v.aiStatus==="pending"||v.aiStatus==="failed")&&(!v.categoryLocked||!v.tagsLocked||!v.titleLocked)||(!v.titleLocked&&isGenericTitle(v.title))));if(!eligible.length){setToast("No videos need AI organization");return}aiRunRef.current=true;setAiRunning(true);let completed=0,failed=0,processed=0;for(let start=0;start<eligible.length;start+=3){const batch=eligible.slice(start,start+3);await Promise.all(batch.map(async video=>{try{const response=await fetch("/api/classify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({video:{url:video.url,title:video.title,notes:video.notes},categories})});if(!response.ok)throw new Error();const suggestion=await response.json() as {title?:string;description?:string;category:string;subcategory:string;tags:string[]};setVideos(current=>current.map(item=>{if(item.id!==video.id)return item;const title=suggestion.title?.trim(),titleOnly=video.aiStatus==="done";return{...item,title:!item.titleLocked&&isGenericTitle(item.title)&&title&&!isGenericTitle(title)?title:item.title,notes:item.notes||suggestion.description||item.notes,category:titleOnly||item.categoryLocked?item.category:suggestion.category,subcategory:titleOnly||item.categoryLocked?item.subcategory:suggestion.subcategory,tags:titleOnly||item.tagsLocked?item.tags:suggestion.tags,aiStatus:"done"}}));completed++}catch{failed++;setVideos(current=>current.map(item=>item.id===video.id?{...item,aiStatus:video.aiStatus==="done"?"done":"failed"}:item))}finally{processed++;setAiProgress(`${processed}/${eligible.length}`)}}))}aiRunRef.current=false;setAiRunning(false);setAiProgress("");setToast(completed?`AI updated ${completed} video${completed===1?"":"s"}${failed?`; ${failed} could not be updated`:""}`:"AI title generation is unavailable. Check the API key.")}
  async function importFile(e:ChangeEvent<HTMLInputElement>){const file=e.target.files?.[0];if(!file)return;try{if(file.name.toLowerCase().endsWith(".json")){const seen=new Set(videos.map(v=>canonicalUrl(v.url))),unique=(JSON.parse(await file.text()) as Video[]).filter(v=>v.url&&!seen.has(canonicalUrl(v.url))).map(v=>({...v,subcategory:v.subcategory??"",status:v.status??"available" as Status,categoryLocked:v.categoryLocked??true,tagsLocked:v.tagsLocked??true,aiStatus:v.aiStatus??"done" as const}));setVideos(a=>[...unique,...a]);setToast(`Imported ${unique.length} videos from backup`)}else{const added=extractVideos(await file.text(),videos);setVideos(a=>[...added,...a]);setToast(added.length?`Imported ${added.length} new links. Organizing…`:"No new links—duplicates and prior corrections were preserved");if(added.length)void autoCategorize(added)} }catch{setToast("Could not read that file")}e.target.value=""}
  async function extractRecipe(video:Video){if(video.recipe){setRecipeVideoId(video.id);return}setRecipeLoadingId(video.id);try{const response=await fetch("/api/recipe",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({video:{url:video.url,title:video.title,notes:video.notes}})});if(!response.ok)throw new Error();const result=await response.json() as {recipe:Recipe|null;descriptionFound?:boolean;facebookBlocked?:boolean};if(!result.recipe){if(video.source==="Facebook"){setRecipePasteVideoId(video.id);setRecipePasteText("");setToast(result.descriptionFound?"Facebook exposed some text, but not enough recipe detail":"Facebook did not expose the reel description to ReelRecall")}else setToast(result.descriptionFound?"The reel description does not contain enough recipe detail":"No usable recipe description was available for this reel");return}setVideos(current=>current.map(item=>item.id===video.id?applyRecipeCandidate(item,{...(result.recipe as Recipe),source:"description"},"description",true):item));setRecipeVideoId(video.id);setToast("Recipe extracted and saved")}catch{setToast("Recipe extraction is unavailable. Check the OpenAI API configuration")}finally{setRecipeLoadingId(null)}}
  async function extractPastedRecipe(){const video=recipePasteVideoId?videos.find(v=>v.id===recipePasteVideoId):null;if(!video||!recipePasteText.trim())return;setRecipeLoadingId(video.id);try{const response=await fetch("/api/recipe",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({video:{url:video.url,title:video.title,notes:video.notes},description:recipePasteText.trim()})});if(!response.ok)throw new Error();const result=await response.json() as {recipe:Recipe|null};if(!result.recipe){setToast("The pasted description still does not contain enough recipe detail");return}setVideos(current=>current.map(item=>item.id===video.id?applyRecipeCandidate(item,{...(result.recipe as Recipe),source:"description"},"description",true):item));setRecipePasteVideoId(null);setRecipePasteText("");setRecipeVideoId(video.id);setToast("Recipe extracted and saved")}catch{setToast("Recipe extraction is unavailable. Check the OpenAI API configuration")}finally{setRecipeLoadingId(null)}}
  async function refreshRecipe(video:Video){setRecipeLoadingId(video.id);try{const response=await fetch("/api/recipe",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({video:{url:video.url,title:video.title,notes:video.notes}})});if(!response.ok)throw new Error();const result=await response.json() as {recipe:Recipe|null;descriptionFound?:boolean};if(!result.recipe){setToast(result.descriptionFound?"The reel description does not contain enough recipe detail":"No usable recipe description was available for this reel");return}setVideos(current=>current.map(item=>item.id===video.id?applyRecipeCandidate(item,{...(result.recipe as Recipe),source:"description"},"description",true):item));setToast("Recipe refreshed")}catch{setToast("Recipe extraction is unavailable. Check the OpenAI API configuration")}finally{setRecipeLoadingId(null)}}
  function openRecipe(videoId:string){setRecipeEditing(false);setRecipeDraft(null);setRecipeVideoId(videoId)}
  function beginRecipeEdit(video:Video){if(!video.recipe)return;setRecipeDraft({title:video.recipe.title,servings:video.recipe.servings,prepTime:video.recipe.prepTime,ingredients:video.recipe.ingredients.join("\n"),steps:video.recipe.steps.join("\n"),notes:video.recipe.notes});setRecipeEditing(true)}
  function saveRecipeEdits(video:Video){if(!video.recipe||!recipeDraft)return;const ingredients=recipeDraft.ingredients.split("\n").map(item=>item.trim()).filter(Boolean),steps=recipeDraft.steps.split("\n").map(item=>item.trim()).filter(Boolean);if(!ingredients.length||!steps.length){setToast("Recipe needs at least one ingredient and one step");return}const updated:Recipe={...video.recipe,source:"manual",title:recipeDraft.title.trim()||video.title,servings:recipeDraft.servings.trim(),prepTime:recipeDraft.prepTime.trim(),ingredients,steps,notes:recipeDraft.notes.trim()};setVideos(current=>current.map(item=>item.id===video.id?applyRecipeCandidate(item,updated,"manual",true):item));setRecipeEditing(false);setRecipeDraft(null);setToast("Recipe changes saved")}
  async function copyRecipe(video:Video){const text=recipeText(video);if(!text)return;try{await navigator.clipboard.writeText(text);setToast("Recipe copied")}catch{setToast("Could not copy recipe")}}
  async function analyzeReelVideo(video:Video){
    if(video.source!=="Facebook"&&video.source!=="Instagram"&&video.source!=="YouTube"){
      setToast("Direct analysis currently supports Facebook, Instagram, and YouTube Shorts");
      return;
    }
    setVideoAnalysisId(video.id);setVideoAnalysisBusy(true);setVideoAnalysisStage(video.source==="YouTube"?"Retrieving YouTube Short and sampling frames…":"Retrieving public reel…");setVideoAnalysisResult(null);setVideoAnalysisOpen(true);try{const response=await fetch("/api/reel-video-recipe",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({video:{url:video.url,title:video.title,notes:video.notes,source:video.source}})});let result:{analysis?:{status?:"success"|"partial"|"error";source?:Source;caption?:string;transcript?:string;onScreenText?:string;thumbnail?:string;evidence?:string[];retrievedAt?:string;message?:string;error?:string;diagnostics?:AnalysisDiagnostics};recipe?:Recipe|null;message?:string;error?:string};
try{result=await response.json()}catch{result={error:`Analysis service returned HTTP ${response.status}`}}const analysis=result.analysis;const status:ReelAnalysisResult["status"]=analysis?.status??(response.ok?(result.recipe?"success":"partial"):"error");setVideoAnalysisResult({videoId:video.id,status,source:(analysis?.source??video.source) as Source,caption:analysis?.caption??"",transcript:analysis?.transcript??"",onScreenText:analysis?.onScreenText??"",thumbnail:analysis?.thumbnail??"",evidence:analysis?.evidence??result.recipe?.evidence??[],recipe:result.recipe??null,message:analysis?.message??result.message??(result.recipe?"Analysis completed. Review the proposed recipe before saving.":"Analysis completed without a recipe."),error:analysis?.error??result.error??(!response.ok?`Analysis failed with HTTP ${response.status}`:""),retrievedAt:analysis?.retrievedAt??new Date().toISOString(),diagnostics:analysis?.diagnostics??null});setVideoAnalysisStage(status==="success"?"Analysis complete":status==="partial"?"Analysis completed with limited results":"Analysis failed")}catch(error){setVideoAnalysisResult({videoId:video.id,status:"error",source:video.source,caption:"",transcript:"",onScreenText:"",thumbnail:"",evidence:[],recipe:null,message:"ReelRecall could not complete this analysis.",error:error instanceof Error?error.message:"Reel analysis failed",retrievedAt:new Date().toISOString(),diagnostics:null});setVideoAnalysisStage("Analysis failed")}finally{setVideoAnalysisBusy(false)}}

  function saveAnalyzedRecipe(){const result=videoAnalysisResult;if(!result?.recipe)return;const origin=result.recipe.source==="description"?"description":"video";setVideos(current=>current.map(item=>item.id===result.videoId?applyRecipeCandidate(item,result.recipe as Recipe,origin,false):item));setVideoAnalysisOpen(false);setRecipeVideoId(result.videoId);setToast("Recipe saved")}
  function retryVideoAnalysis(){const video=videoAnalysisId?videos.find((v:Video)=>v.id===videoAnalysisId):null;if(video)void analyzeReelVideo(video)}
  function restoreRecipeVersion(videoId:string,index:number){
    setVideos(current=>current.map(video=>{
      if(video.id!==videoId)return video;
      const history=video.recipeHistory??[];
      const chosen=history[index];
      if(!chosen)return video;
      const remaining=history.filter((_,i)=>i!==index);
      const nextHistory=video.recipe
        ?[{recipe:video.recipe,savedAt:new Date().toISOString(),reason:"Replaced by restored recipe"},...remaining].slice(0,25)
        :remaining;
      return{...video,recipe:chosen.recipe,recipeHistory:nextHistory};
    }));
    setToast("Previous recipe restored");
  }

  async function runFoodRecipeAudit(){
    if(recipeAuditRunningRef.current){
      setRecipeAuditOpen(true);
      return;
    }

    const queue=videos.filter(video=>video.category==="Food"&&video.status==="available");
    setRecipeAuditOpen(true);

    if(!queue.length){
      setRecipeAudit(current=>({...current,running:false,total:0,completed:0,items:[]}));
      setToast("No available Food videos to audit");
      return;
    }

    recipeAuditRunningRef.current=true;
    recipeAuditStopRef.current=false;
    setRecipeAudit({running:true,total:queue.length,completed:0,upgraded:0,added:0,kept:0,protected:0,failed:0,currentIds:[],items:[]});

    let cursor=0;

    const record=(video:Video,status:RecipeAuditStatus,message:string)=>{
      setRecipeAudit(current=>({
        ...current,
        completed:Math.min(current.total,current.completed+1),
        upgraded:current.upgraded+(status==="upgraded"?1:0),
        added:current.added+(status==="added"?1:0),
        kept:current.kept+(status==="kept"||status==="unavailable"?1:0),
        protected:current.protected+(status==="protected"?1:0),
        failed:current.failed+(status==="failed"?1:0),
        currentIds:current.currentIds.filter(id=>id!==video.id),
        items:[...current.items,{videoId:video.id,title:video.title,status,message}]
      }));
    };

    const worker=async()=>{
      while(true){
        if(recipeAuditStopRef.current)return;
        const index=cursor++;
        if(index>=queue.length)return;
        const video=queue[index];

        setRecipeAudit(current=>({...current,currentIds:[...new Set([...current.currentIds,video.id])]}));

        if(video.recipe?.source==="manual"){
          record(video,"protected","Manual/user-edited recipe protected. Description was not allowed to overwrite it.");
          continue;
        }

        try{
          const controller=new AbortController();
          const timeoutId=window.setTimeout(()=>controller.abort(),45000);
          let response:Response;
          let result:{recipe?:Recipe|null;descriptionFound?:boolean;facebookBlocked?:boolean;message?:string};
          try{
            response=await fetch("/api/recipe",{
              method:"POST",
              headers:{"Content-Type":"application/json"},
              body:JSON.stringify({video:{url:video.url,title:video.title,notes:video.notes}}),
              signal:controller.signal
            });
            result=await response.json() as {recipe?:Recipe|null;descriptionFound?:boolean;facebookBlocked?:boolean;message?:string};
          }finally{
            window.clearTimeout(timeoutId);
          }

          if(!response.ok){
            record(video,"failed",result.message||`Description check returned HTTP ${response.status}.`);
            continue;
          }

          if(!result.recipe){
            record(video,"unavailable",result.descriptionFound?"Description was found but did not contain a usable structured recipe.":"No usable public description recipe was available.");
            continue;
          }

          const candidate:Recipe={...result.recipe,source:"description"};
          const current=video.recipe;

          if(!current){
            setVideos(existing=>existing.map(item=>item.id===video.id?applyRecipeCandidate(item,candidate,"description",true):item));
            record(video,"added",`Recovered ${candidate.ingredients.length} ingredients and ${candidate.steps.length} steps from the description.`);
            continue;
          }

          if(descriptionRecipeIsRicher(current,candidate)){
            const before=`${current.ingredients.length} ingredients / ${current.steps.length} steps`;
            const after=`${candidate.ingredients.length} ingredients / ${candidate.steps.length} steps`;
            setVideos(existing=>existing.map(item=>item.id===video.id?applyRecipeCandidate(item,candidate,"description",true):item));
            record(video,"upgraded",`Description recipe was richer: ${before} → ${after}. Previous recipe archived.`);
          }else{
            record(video,"kept",`Saved recipe kept (${current.ingredients.length} ingredients / ${current.steps.length} steps); description was not materially richer.`);
          }
        }catch(error){
          const timedOut=error instanceof DOMException&&error.name==="AbortError";
          record(video,"failed",timedOut
            ?"Description check timed out after 45 seconds. Skipped so the audit could continue."
            :error instanceof Error?error.message:"Description recipe check failed.");
        }

        await new Promise<void>(resolve=>window.setTimeout(resolve,40));
      }
    };

    try{
      await Promise.all(Array.from({length:Math.min(2,queue.length)},()=>worker()));
    }finally{
      recipeAuditRunningRef.current=false;
      setRecipeAudit(current=>({...current,running:false,currentIds:[]}));
      setToast(recipeAuditStopRef.current?"Food recipe audit stopped":"Food recipe audit finished");
    }
  }

  function exportBackup(){const blob=new Blob([JSON.stringify(videos,null,2)],{type:"application/json"}),a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=`saved-video-library-${new Date().toISOString().slice(0,10)}.json`;a.click();URL.revokeObjectURL(a.href)}
  function addCategory(){const name=newCategory.trim();if(!name||categories.some(c=>c.name.toLowerCase()===name.toLowerCase()))return;setCategories(a=>[...a.slice(0,-1),{id:crypto.randomUUID(),name,subcategories:[]},a.at(-1)!]);setNewCategory("")}
  function renameCategory(id:string,name:string){const old=categories.find(c=>c.id===id)?.name;if(!old||!name.trim())return;setCategories(a=>a.map(c=>c.id===id?{...c,name:name.trim()}:c));setVideos(a=>a.map(v=>v.category===old?{...v,category:name.trim()}:v));if(category===old)setCategory(name.trim())}
  function deleteCategory(id:string){const c=categories.find(x=>x.id===id);if(!c||c.name==="Uncategorized"||!confirm(`Delete ${c.name}? Its videos will move to Uncategorized.`))return;setCategories(a=>a.filter(x=>x.id!==id));setVideos(a=>a.map(v=>v.category===c.name?{...v,category:"Uncategorized",subcategory:""}:v));chooseCategory("All")}
  function addSub(id:string){const value=(newSubs[id]??"").trim();if(!value)return;setCategories(a=>a.map(c=>c.id===id&&!c.subcategories.includes(value)?{...c,subcategories:[...c.subcategories,value]}:c));setNewSubs(a=>({...a,[id]:""}))}
  function deleteSub(cat:string,sub:string){setCategories(a=>a.map(c=>c.name===cat?{...c,subcategories:c.subcategories.filter(s=>s!==sub)}:c));setVideos(a=>a.map(v=>v.category===cat&&v.subcategory===sub?{...v,subcategory:""}:v))}
  async function clearAllVideos(){try{const response=await fetch("/api/library",{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({videos:[],categories})});if(!response.ok)throw new Error();setVideos([]);localStorage.setItem(STORAGE_KEY,"[]");setPlayingId(null);setCategory("All");setSubcategory("");setFavorites(false);setShowArchive(false);setClearStep(0);setToast("All videos were cleared. Categories were preserved.")}catch{setToast("Could not clear the video library")}}
  const aiQueue=videos.filter(v=>v.status==="available"&&(((v.aiStatus==="pending"||v.aiStatus==="failed")&&(!v.categoryLocked||!v.tagsLocked||!v.titleLocked))||(!v.titleLocked&&isGenericTitle(v.title))));
  const recipeVideo=recipeVideoId?videos.find(v=>v.id===recipeVideoId)??null:null;
  return <main className="app-shell"><aside className="sidebar"><a className="brand" href="#top"><Image className="brand-logo" src="/icons/reelreplay-mark.png" alt="" width={42} height={42} priority/><strong>ReelRecall</strong></a><nav className="side-menu"><p>Library</p><button className={category==="All"&&!favorites&&!showArchive?"active":""} onClick={()=>chooseCategory("All")}><span>All videos</span><b>{videos.filter(v=>v.status==="available").length}</b></button><button className={favorites?"active":""} onClick={()=>{setFavorites(true);setShowArchive(false);setExpandedCategory("");setCategory("All");setSubcategory("")}}><span>♥ Favorites</span><b>{videos.filter(v=>v.favorite&&v.status==="available").length}</b></button><button className={showArchive?"active":""} onClick={()=>{setShowArchive(true);setFavorites(false);setExpandedCategory("");setCategory("All");setSubcategory("")}}><span>▣ Archive</span><b>{videos.filter(v=>v.status==="unavailable").length}</b></button><div className="menu-divider"/>{categories.map(c=><div className="menu-group" key={c.id}><button className={category===c.name&&!favorites&&!showArchive?"active":""} onClick={()=>chooseCategory(c.name)} aria-expanded={expandedCategory===c.name}><span>{c.name}</span><b>{videos.filter(v=>v.category===c.name&&v.status==="available").length}</b></button>{expandedCategory===c.name&&c.subcategories.length?<div className="submenu">{c.subcategories.map(s=><button key={s} className={subcategory===s?"active":""} onClick={()=>setSubcategory(s)}>{s}</button>)}</div>:null}</div>)}</nav><button className="settings-link" onClick={()=>setSettingsOpen(true)}>⚙ <span>Settings</span></button></aside><div className="app-content"><header><div className="header-actions"><button type="button" className="quiet" onClick={()=>{setRecipeAuditOpen(true);void runFoodRecipeAudit()}} disabled={recipeAudit.running}>{recipeAudit.running?`Auditing ${recipeAudit.completed}/${recipeAudit.total}…`:"🧾 Audit Food Recipes"}</button><button className="quiet" onClick={()=>setWeeklyMenuOpen(true)}>▦ Weekly Menu</button><button className="quiet" onClick={()=>void autoCategorize(aiQueue)} disabled={aiRunning||!aiQueue.length}>{aiRunning?`Organizing ${aiProgress}…`:aiQueue.length?`✦ AI Organize (${aiQueue.length})`:"✓ AI Organized"}</button><button className="quiet" onClick={exportBackup} disabled={!videos.length}>Export backup</button><button className="quiet" onClick={async()=>{await fetch("/api/auth/logout",{method:"POST"});location.href="/sign-in"}}>Sign out</button><button className="primary" onClick={openNew}>＋ Add video</button></div></header>
  <section className="intro compact-intro" id="top"><div><p className="kicker">REELRECALL</p><h1>Save it. <em>Find it.</em></h1></div></section><section className="toolbar"><label className="search"><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search videos, notes, or tags"/></label></section><section className="results-head"><h2>{showArchive?"Archive":favorites?"Favorite videos":subcategory||category==="All"?subcategory||"All videos":category}</h2><span>{filtered.length} {filtered.length===1?"video":"videos"} · newest first</span></section>
  {videoAnalysisBusy&&videoAnalysisId?<div className="video-analysis-banner"><span className="spinner"/><div><strong>{videoAnalysisStage||"Analyzing reel…"}</strong><small>The result window will stay open when retrieval finishes.</small></div></div>:null}
  {!ready?<div className="empty">Loading…</div>:filtered.length?<section className="grid">{filtered.map(v=><VideoCard key={v.id} video={v} playing={playingId===v.id} onPlay={()=>setPlayingId(v.id)} onEdit={()=>openEdit(v)} onDelete={()=>setVideos(a=>a.filter(x=>x.id!==v.id))} onFavorite={()=>setVideos(a=>a.map(x=>x.id===v.id?{...x,favorite:!x.favorite}:x))} onStatus={()=>{setPlayingId(null);setVideos(a=>a.map(x=>x.id===v.id?{...x,status:x.status==="available"?"unavailable":"available"}:x));setToast(v.status==="available"?"Moved to Archive":"Restored to library")}} onRecipe={()=>openRecipe(v.id)} recipeLoading={recipeLoadingId===v.id} onAnalyzeVideo={()=>{if(videoAnalysisResult?.videoId===v.id&&!videoAnalysisBusy){setVideoAnalysisId(v.id);setVideoAnalysisOpen(true)}else void analyzeReelVideo(v)}} videoAnalyzing={videoAnalysisBusy&&videoAnalysisId===v.id} analysisReady={videoAnalysisResult?.videoId===v.id&&!videoAnalysisBusy}/>)}</section>:<section className="empty"><div>🎬</div><h2>{showArchive?"Archive is empty":videos.length?"No videos match":"Your ReelRecall library is ready"}</h2><p>{showArchive?"Videos marked unavailable will appear here.":"Import your WhatsApp chat to collect supported video links."}</p></section>}
  {recipeAuditOpen?<div className="dialog-backdrop recipe-audit-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!recipeAudit.running)setRecipeAuditOpen(false)}}><div className="dialog recipe-audit-dialog"><button type="button" className="dialog-close" onClick={()=>setRecipeAuditOpen(false)} disabled={recipeAudit.running}>×</button><p className="kicker">RECIPE PROTECTION</p><h2>Food Recipe Audit</h2><p>Checks every available Food video against the recipe in its public description. A saved recipe is replaced only when the description version is materially richer. Manual recipes are protected, and every replaced recipe is archived in Recipe History.</p><div className="recipe-audit-summary"><strong>{recipeAudit.completed} / {recipeAudit.total}</strong><span>{recipeAudit.upgraded} upgraded</span><span>{recipeAudit.added} recovered</span><span>{recipeAudit.protected} protected</span><span>{recipeAudit.failed} failed</span></div>{recipeAudit.running?<><div className="batch-progress-track"><div className="batch-progress-fill" style={{width:`${recipeAudit.total?Math.min(100,Math.round(recipeAudit.completed/recipeAudit.total*100)):0}%`}}/></div>{recipeAudit.currentIds.length?<p className="recipe-audit-current">Checking: {recipeAudit.currentIds.map(id=>videos.find(video=>video.id===id)?.title).filter(Boolean).join(" · ")}</p>:null}<button type="button" onClick={()=>{recipeAuditStopRef.current=true}}>Stop after current</button></>:<div className="analysis-actions"><button type="button" className="primary" onClick={()=>void runFoodRecipeAudit()}>Run Audit Again</button><button type="button" onClick={()=>setRecipeAuditOpen(false)}>Close</button></div>}<div className="recipe-audit-results">{recipeAudit.items.slice().reverse().map(item=><div className={`recipe-audit-row ${item.status}`} key={`${item.videoId}-${item.status}-${item.message}`}><strong>{item.title}</strong><span>{item.status}</span><small>{item.message}</small></div>)}</div></div></div>:null}
{recipePasteVideoId?<div className="dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setRecipePasteVideoId(null)}}><div className="dialog facebook-recipe-paste"><button className="dialog-close" onClick={()=>setRecipePasteVideoId(null)}>×</button><p className="kicker">FACEBOOK RECIPE</p><h2>Paste the reel description</h2><p>Facebook is allowing the reel to play, but it did not expose the caption text to ReelRecall's server. Copy the recipe text from the Facebook reel description and paste it below.</p><textarea value={recipePasteText} onChange={e=>setRecipePasteText(e.target.value)} placeholder="Paste the Facebook reel description, ingredients and cooking steps here…" autoFocus/><div className="recipe-footer"><button type="button" className="primary" onClick={()=>void extractPastedRecipe()} disabled={!recipePasteText.trim()||recipeLoadingId===recipePasteVideoId}>{recipeLoadingId===recipePasteVideoId?"Extracting…":"Extract Recipe"}</button><button type="button" onClick={()=>setRecipePasteVideoId(null)}>Cancel</button>{recipePasteVideoId?(()=>{const v=videos.find(x=>x.id===recipePasteVideoId);return v?<a href={v.url} target="_blank" rel="noreferrer">Open Facebook ↗</a>:null})():null}</div></div></div>:null}
  {recipeVideo?.recipe?<div className="dialog-backdrop recipe-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget){setRecipeVideoId(null);setRecipeEditing(false);setRecipeDraft(null)}}}><div className="dialog recipe-dialog"><button className="dialog-close" onClick={()=>{setRecipeVideoId(null);setRecipeEditing(false);setRecipeDraft(null)}}>×</button><p className="kicker">SAVED RECIPE</p>{recipeEditing&&recipeDraft?<><h2>Edit recipe</h2><div className="recipe-edit-form"><label>Recipe title<input value={recipeDraft.title} onChange={e=>setRecipeDraft({...recipeDraft,title:e.target.value})}/></label><div className="form-row"><label>Servings<input value={recipeDraft.servings} onChange={e=>setRecipeDraft({...recipeDraft,servings:e.target.value})}/></label><label>Prep / cooking time<input value={recipeDraft.prepTime} onChange={e=>setRecipeDraft({...recipeDraft,prepTime:e.target.value})}/></label></div><label>Ingredients <small>One ingredient per line</small><textarea rows={10} value={recipeDraft.ingredients} onChange={e=>setRecipeDraft({...recipeDraft,ingredients:e.target.value})}/></label><label>Steps <small>One step per line</small><textarea rows={10} value={recipeDraft.steps} onChange={e=>setRecipeDraft({...recipeDraft,steps:e.target.value})}/></label><label>Notes<textarea rows={4} value={recipeDraft.notes} onChange={e=>setRecipeDraft({...recipeDraft,notes:e.target.value})}/></label>{recipeVideo.recipeHistory?.length?<details className="recipe-history"><summary>Recipe History ({recipeVideo.recipeHistory.length})</summary><div className="recipe-history-list">{recipeVideo.recipeHistory.map((entry,index)=><div className="recipe-history-row" key={`${entry.savedAt}-${index}`}><div><strong>{entry.recipe.title||recipeVideo.title}</strong><small>{new Date(entry.savedAt).toLocaleString()} · {entry.reason}</small><span>{entry.recipe.ingredients.length} ingredients · {entry.recipe.steps.length} steps · {entry.recipe.source||"unknown source"}</span></div><button type="button" onClick={()=>restoreRecipeVersion(recipeVideo.id,index)}>Restore</button></div>)}</div></details>:null}<div className="recipe-footer"><button type="button" className="primary" onClick={()=>saveRecipeEdits(recipeVideo)}>Save Changes</button><button type="button" onClick={()=>{setRecipeEditing(false);setRecipeDraft(null)}}>Cancel</button></div></div></>:<><h2>{recipeVideo.recipe.title||recipeVideo.title}</h2>{recipeVideo.recipe.servings||recipeVideo.recipe.prepTime?<div className="recipe-meta">{recipeVideo.recipe.servings?<span>🍽 {recipeVideo.recipe.servings}</span>:null}{recipeVideo.recipe.prepTime?<span>⏱ {recipeVideo.recipe.prepTime}</span>:null}</div>:null}<section className="recipe-section"><h3>Ingredients</h3><ul>{recipeVideo.recipe.ingredients.map((item,index)=><li key={`${index}-${item}`}>{item}</li>)}</ul></section><section className="recipe-section"><h3>Steps</h3><ol>{recipeVideo.recipe.steps.map((step,index)=><li key={`${index}-${step}`}>{step}</li>)}</ol></section>{recipeVideo.recipe.notes?<section className="recipe-section recipe-notes"><h3>Notes</h3><p>{recipeVideo.recipe.notes}</p></section>:null}{recipeVideo.recipe.evidence?.length?<div className="recipe-evidence"><strong>AI used</strong>{recipeVideo.recipe.evidence.map(item=><span key={item}>{item}</span>)}</div>:null}<div className="recipe-footer"><button type="button" className="primary" onClick={()=>beginRecipeEdit(recipeVideo)}>Edit Recipe</button><button type="button" onClick={()=>void copyRecipe(recipeVideo)}>Copy Recipe</button><button type="button" onClick={()=>void refreshRecipe(recipeVideo)} disabled={recipeLoadingId===recipeVideo.id}>{recipeLoadingId===recipeVideo.id?"Refreshing…":"Refresh from description"}</button><a href={recipeVideo.url} target="_blank" rel="noreferrer">Open original ↗</a></div><small className="recipe-disclaimer">{recipeVideo.recipe.source==="video"?"Generated from reel/video evidence. Review and edit quantities or steps whenever needed.":"Extracted from the saved/public reel description. Review and edit as needed."}</small></>}</div></div>:null}
  {weeklyMenuOpen?<div className="dialog-backdrop weekly-menu-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setWeeklyMenuOpen(false)}}><WeeklyMenuPlanner videos={videos} onClose={()=>setWeeklyMenuOpen(false)} onRecipeSaved={(videoId,recipe)=>setVideos(current=>current.map(item=>item.id===videoId?applyRecipeCandidate(item,recipe,recipe.source==="manual"?"manual":recipe.source==="description"?"description":"video",recipe.source==="manual"):item))} onOpenRecipe={openRecipe}/></div>:null}{managerOpen?<div className="dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setManagerOpen(false)}}><div className="dialog category-manager"><button className="dialog-close" onClick={()=>setManagerOpen(false)}>×</button><p className="kicker">ORGANIZE YOUR LIBRARY</p><h2>Manage categories</h2><div className="add-category"><input value={newCategory} onChange={e=>setNewCategory(e.target.value)} placeholder="New category"/><button className="primary" onClick={addCategory}>Add</button></div><div className="category-list">{categories.map(c=><section key={c.id}><div className="category-name"><input defaultValue={c.name} disabled={c.name==="Uncategorized"} onBlur={e=>renameCategory(c.id,e.target.value)}/>{c.name!=="Uncategorized"?<button className="danger" onClick={()=>deleteCategory(c.id)}>Delete</button>:null}</div><div className="subcategory-list">{c.subcategories.map(s=><span key={s}>{s}<button onClick={()=>deleteSub(c.name,s)}>×</button></span>)}</div><div className="add-sub"><input value={newSubs[c.id]??""} onChange={e=>setNewSubs({...newSubs,[c.id]:e.target.value})} placeholder="Add subcategory"/><button onClick={()=>addSub(c.id)}>Add</button></div></section>)}</div></div></div>:null}{toast?<div className="toast">{toast}</div>:null}</div></main>
}
