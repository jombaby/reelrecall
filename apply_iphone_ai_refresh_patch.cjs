const fs = require("fs");
const path = require("path");

const pagePath = path.join(process.cwd(), "app", "page.tsx");
if (!fs.existsSync(pagePath)) {
  console.error("Error: app/page.tsx was not found. Run this from the ReelRecall project folder.");
  process.exit(1);
}

let source = fs.readFileSync(pagePath, "utf8");

const newEffect = 'useEffect(()=>{if(!ready||aiRunning)return;const pending=videos.filter(v=>v.aiStatus==="pending");if(pending.length)void autoCategorize(pending)},[ready,videos,aiRunning]);';

const marker = '  const formSubs=categories.find(c=>c.name===form.category)?.subcategories??[]';
const refreshEffect = `  useEffect(()=>{if(!ready)return;let refreshing=false;const refreshSharedVideos=async()=>{if(refreshing||document.visibilityState!=="visible")return;refreshing=true;try{const response=await fetch("/api/library",{cache:"no-store"});if(response.status===401){location.href="/sign-in";return}if(!response.ok)return;const result=await response.json() as {exists:boolean;data?:{videos?:Partial<Video>[];categories?:Category[]}};if(result.exists&&result.data){setVideos(normalizeStoredVideos(result.data.videos??[]));if(result.data.categories?.length)setCategories(result.data.categories)}}finally{refreshing=false}};const onVisible=()=>{if(document.visibilityState==="visible")void refreshSharedVideos()};document.addEventListener("visibilitychange",onVisible);window.addEventListener("focus",onVisible);void refreshSharedVideos();return()=>{document.removeEventListener("visibilitychange",onVisible);window.removeEventListener("focus",onVisible)}},[ready]);\n`;

if (!source.includes(newEffect)) {
  if (!source.includes(marker)) {
    console.error("Error: Could not find the insertion point in app/page.tsx. No files were changed.");
    process.exit(1);
  }
  source = source.replace(marker, `  ${newEffect}\n` + marker);
}

if (!source.includes("refreshSharedVideos")) {
  if (!source.includes(marker)) {
    console.error("Error: Could not find the insertion point in app/page.tsx. No files were changed.");
    process.exit(1);
  }
  source = source.replace(marker, refreshEffect + marker);
}

fs.writeFileSync(pagePath, source);
console.log("ReelRecall iPhone AI refresh patch applied successfully.");
console.log("Updated: app/page.tsx");
