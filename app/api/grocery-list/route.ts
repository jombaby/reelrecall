import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";

type MenuItem={schedule:string;videoId:string;title:string;ingredients:string[];recipeMissing?:boolean};
type SummaryItem={item:string;quantity:string;usedBy:string[]};
type ParsedIngredient={item:string;quantity:string;usedBy:string;raw:string};

const AISLE_ORDER=["Produce","Meat & Seafood","Dairy & Eggs","Bakery & Bread","Rice, Pasta & Grains","Canned & Jarred","Spices & Seasonings","Sauces, Oils & Condiments","Baking","Frozen","Beverages","Pantry & Dry Goods"] as const;

function clean(value:unknown,max=400){return typeof value==="string"?value.trim().slice(0,max):""}
function titleCase(value:string){return value.split(/\s+/).filter(Boolean).map(word=>word.charAt(0).toUpperCase()+word.slice(1).toLowerCase()).join(" ")}
function stripNoise(raw:string){
  return raw
    .replace(/\bas listed in recipes\b/gi,"")
    .replace(/[•*]/g," ")
    .replace(/\b(?:exact\s+)?amount\s+not\s+specified\b/gi,"")
    .replace(/\botherwise\s*$/gi,"")
    .replace(/\s+/g," ")
    .replace(/^[-–—,:;\s]+|[-–—,:;\s]+$/g,"")
    .trim();
}
function expandIngredient(raw:string){
  const value=stripNoise(raw);
  if(!value)return[];
  const amountOf=value.match(/^amount\s+of\s+(.+?)\s+not\s+specified$/i);
  if(amountOf)return[amountOf[1].trim()];
  const juice=value.match(/^[^:]{2,100}\bjuice\s*:\s*(.+)$/i);
  if(juice&&juice[1].includes(","))return juice[1].split(",").map(part=>part.trim()).filter(Boolean);
  if(/^salt\s+and\s+black\s+pepper\b/i.test(value))return["Salt","Black Pepper"];
  if(/^ginger\s+and\s+garlic\b/i.test(value))return["Ginger","Garlic"];
  return[value];
}
function splitQuantity(raw:string){
  let value=stripNoise(raw),quantity="";
  if(!value)return{item:"",quantity:""};

  const amountOf=value.match(/^amount\s+of\s+(.+?)\s+not\s+specified$/i);
  if(amountOf)return{item:amountOf[1].trim(),quantity:""};

  const juiceOf=value.match(/^juice\s+of\s+(\d+)\s+(.+)$/i);
  if(juiceOf)return{item:juiceOf[2].trim(),quantity:juiceOf[1]};

  const halfKg=value.match(/^half\s+(?:a\s+)?(?:kg|kilogram|kilograms)\s+(.+)$/i);
  if(halfKg)return{item:halfKg[1].trim(),quantity:"0.5 kg"};
  const halfItem=value.match(/^half\s+(?:an?|one)\s+(.+)$/i);
  if(halfItem)return{item:halfItem[1].trim(),quantity:"0.5"};

  value=value
    .replace(/^(?:a\s+little|a\s+piece\s+of|a\s+handful\s+of|handful\s+of|a\s+pinch\s+of|a\s+few|few|some)\s+/i,"")
    .replace(/^(?:washed|ripe|seedless|soft|hot|crispy|cubed|cooked|roasted|frozen|thick|natural|extra)\s+/i,"")
    .trim();

  const num='(?:\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞]|one|two|three|four|five|six|seven|eight|nine|ten)';
  const unit='(?:cups?|tbsp|tablespoons?|tbsps?|tsp|teaspoons?|lbs?|pounds?|oz|ounces?|kgs?|kilograms?|grams?|g|gms?|ml|milliliters?|liters?|litres?|l|cloves?|cans?|packages?|packs?|pieces?|pcs?|bunches?|bunch|sprigs?|cubes?|nos?|slices?|stalks?)';
  const leading=new RegExp(`^-?\\s*(${num})\\s*(${unit})?\\b\\s*(.+)$`,"i");
  const trailing=new RegExp(`^(.+?)\\s*[-–—,:;]?\\s+(${num})\\s*(${unit})?\\s*$`,"i");
  const lead=value.match(leading),tail=value.match(trailing);
  if(lead){quantity=`${lead[1]}${lead[2]?` ${lead[2]}`:""}`.trim();value=lead[3].trim()}
  else if(tail){value=tail[1].trim();quantity=`${tail[2]}${tail[3]?` ${tail[3]}`:""}`.trim()}

  value=value
    .replace(/^(?:tbsp|tablespoons?|tbsps?|tsp|teaspoons?|cups?|grams?|gms?)\s+/i,"")
    .replace(/\s*[-–—,:;]+\s*(?:a\s+little|a\s+handful|a\s+pinch|a\s+few(?:\s+slices?)?|few\s+slices?|some|as\s+needed|to\s+taste|two\s+cubes?)\s*$/i,"")
    .replace(/\s+/g," ")
    .trim();

  return{item:value,quantity:stripNoise(quantity)};
}
function canonicalIngredient(raw:string){
  let item=stripNoise(raw).toLowerCase();
  if(!item)return"";

  item=item
    .replace(/,\s*(?:as\s+a\s+substitute\s+for|substitute\s+for|any\s+color|seeds?\s+removed|for\s+fluffier\s+texture).*$/i,"")
    .replace(/\byou\s+can\s+also\s+mix\s+both\b.*$/i,"")
    .replace(/\bwith\s+skin\b/g," ")
    .replace(/\b(?:washed|fresh|finely|roughly|thinly|thickly|chopped|diced|minced|sliced|grated|shredded|crushed|peeled|trimmed|divided|optional|for garnish|for serving|ripe|seedless|soft|hot|crispy|cubed|soaked|cooked|frozen|roasted|extra|for topping)\b/g," ")
    .replace(/\s+/g," ")
    .replace(/^[-–—,:;\s]+|[-–—,:;\s]+$/g,"")
    .trim();

  if(!item||/^(?:water|hot water|glass of water|foil|ingredient unclear|dry ingredients?|ice cream sticks?(?: or toothpicks)?|toothpicks?|lemon rice)$/.test(item))return"";

  if(/^butter\s+or\s+olive\s+oil$/.test(item))return"Butter or Olive Oil";
  if(/^basil\s+or\s+parsley$/.test(item))return"Basil or Parsley";
  if(/^cheddar\s+or\s+mozzarella/.test(item))return"Cheddar or Mozzarella";

  if(/\beggs?\b/.test(item)&&!/(eggplant|egg noodle)/.test(item))return"Eggs";
  if(/\bchicken\s+breasts?\b/.test(item))return"Chicken Breast";
  if(/\bchicken\s+thighs?\b/.test(item))return"Chicken Thigh";
  if(/\bchicken\s+leg\b/.test(item))return"Chicken Leg";
  if(/\bboneless\s+chicken\b/.test(item))return"Chicken";
  if(/^chicken$/.test(item))return"Chicken";
  if(/\b(?:shrimp|prawns?)\b/.test(item))return"Shrimp";
  if(/\bground\s+beef\b/.test(item))return"Ground Beef";
  if(/\bsirloin\s+steak\b|^steak$/.test(item))return"Steak";

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
  if(/^(?:black\s+pepper(?:\s+powder)?|pepper\s+powder|pepper)$/.test(item))return"Black Pepper";
  if(/^black\s+peppercorns?$/.test(item))return"Black Peppercorns";
  if(/^paprika(?:\s+powder)?$/.test(item))return"Paprika";
  if(/^(?:chilli|chili)\s+powder$/.test(item))return"Chili Powder";
  if(/^(?:chilli|chili)\s+flakes$/.test(item))return"Chili Flakes";
  if(/^(?:dry|dried)\s+red\s+chill?i$/.test(item))return"Dried Red Chili";
  if(/^red\s+chill?i$/.test(item))return"Red Chili";
  if(/^ginger$/.test(item))return"Ginger";
  if(/^avocados?$/.test(item))return"Avocado";
  if(/^cucumbers?$/.test(item))return"Cucumber";
  if(/^zucchini$/.test(item))return"Zucchini";
  if(/^mushrooms?$/.test(item))return"Mushrooms";
  if(/^broccoli$/.test(item))return"Broccoli";
  if(/^beetroot$|^beets?$/.test(item))return"Beets";
  if(/^bananas?(?:\s+slices?)?$/.test(item))return"Banana";
  if(/^green\s+apples?$/.test(item))return"Green Apple";
  if(/^red\s+apples?$/.test(item))return"Red Apple";
  if(/^apples?$/.test(item))return"Apple";
  if(/^pineapple$/.test(item))return"Pineapple";
  if(/^strawberries?$/.test(item))return"Strawberries";
  if(/^blueberries?$/.test(item))return"Blueberries";
  if(/^kiwis?$/.test(item))return"Kiwi";
  if(/^watermelon(?:\s+cubes?)?$/.test(item))return"Watermelon";
  if(/^lemons?$/.test(item)||/^lemon\s+juice$/.test(item))return"Lemon";
  if(/^limes?$/.test(item)||/^lime\s+juice$/.test(item))return"Lime";

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

  return titleCase(item);
}
function groceryAisleFor(raw:string){
  const item=raw.toLowerCase();
  if(/\b(black pepper|peppercorn|paprika|cumin|turmeric|cardamom|cinnamon|clove|nutmeg|garam masala|curry powder|chili powder|chili flakes|onion powder|garlic powder|coriander powder|coriander seeds|asafoetida|hing|seasoning|oregano|thyme|rosemary|bay leaves|salt|saffron|sesame seeds|dried red chili)\b/.test(item))return"Spices & Seasonings";
  if(/\b(oil|vinegar|soy sauce|hot sauce|ketchup|mustard|mayonnaise|mayo|sriracha|honey|maple syrup|sauce|paste|dressing|chutney)\b/.test(item))return"Sauces, Oils & Condiments";
  if(/\b(coconut milk|broth|bouillon|stock|tomato paste|tomato sauce|canned|beans|chickpeas|lentils)\b/.test(item))return"Canned & Jarred";
  if(/\b(milk|cream|butter|cheese|yogurt|egg|eggs|paneer|sour cream|feta|mozzarella|parmesan)\b/.test(item))return"Dairy & Eggs";
  if(/\b(chicken|beef|pork|turkey|lamb|steak|sausage|bacon|shrimp|salmon|tuna|tilapia|fish|crab|lobster)\b/.test(item))return"Meat & Seafood";
  if(/\b(onion|garlic|ginger|tomato|potato|carrot|celery|bell pepper|spinach|lettuce|cabbage|cauliflower|broccoli|cilantro|parsley|mint|basil|lemon|lime|orange|apple|banana|mango|pineapple|avocado|cucumber|zucchini|mushroom|jalapeno|beet|watermelon|strawberr|blueberr|kiwi|asparagus|sweet potato|curry leaves)\b/.test(item))return"Produce";
  if(/\b(bread|bun|roll|tortilla|pita|naan|bagel|croissant|tostada shell)\b/.test(item))return"Bakery & Bread";
  if(/\b(rice|pasta|noodle|spaghetti|macaroni|quinoa|oat|oats|couscous|barley|rava|semolina)\b/.test(item))return"Rice, Pasta & Grains";
  if(/\b(baking soda|baking powder|yeast|vanilla|cocoa|chocolate|sugar|cornstarch|flour)\b/.test(item))return"Baking";
  if(/\b(frozen|ice cream)\b/.test(item))return"Frozen";
  if(/\b(coffee|tea|chai|juice|soda|sparkling water|coconut water|drink)\b/.test(item))return"Beverages";
  return"Pantry & Dry Goods";
}
function buildCanonicalEntries(menuItems:MenuItem[]){
  const result:ParsedIngredient[]=[];
  for(const menu of menuItems){
    if(menu.recipeMissing)continue;
    const usedBy=`${menu.schedule} — ${menu.title}`;
    for(const raw of menu.ingredients){
      for(const expanded of expandIngredient(raw)){
        const parsed=splitQuantity(expanded);
        const item=canonicalIngredient(parsed.item);
        if(!item)continue;
        result.push({item,quantity:parsed.quantity,usedBy,raw});
      }
    }
  }
  return result;
}
function fallbackSummary(entries:ParsedIngredient[]){
  const map=new Map<string,{item:string;quantities:Set<string>;usedBy:Set<string>}>();
  for(const entry of entries){
    const key=entry.item.toLowerCase();
    const current=map.get(key)??{item:entry.item,quantities:new Set<string>(),usedBy:new Set<string>()};
    if(entry.quantity)current.quantities.add(entry.quantity);
    current.usedBy.add(entry.usedBy);
    map.set(key,current);
  }
  return[...map.values()].map(value=>({
    item:value.item,
    quantity:value.quantities.size===1?[...value.quantities][0]:value.quantities.size>1?"See recipes":"",
    usedBy:[...value.usedBy]
  }));
}
function finalDedupe(summary:SummaryItem[]){
  const map=new Map<string,{item:string;quantities:Set<string>;usedBy:Set<string>}>();
  for(const row of summary){
    const item=canonicalIngredient(row.item);
    if(!item)continue;
    const key=item.toLowerCase();
    const current=map.get(key)??{item,quantities:new Set<string>(),usedBy:new Set<string>()};
    const quantity=stripNoise(row.quantity).replace(/^as listed in recipes$/i,"").trim();
    if(quantity)current.quantities.add(quantity);
    for(const usedBy of row.usedBy??[])if(clean(usedBy,300))current.usedBy.add(clean(usedBy,300));
    map.set(key,current);
  }
  return[...map.values()]
    .map(value=>({
      item:value.item,
      quantity:value.quantities.size===1?[...value.quantities][0]:value.quantities.size>1?"See recipes":"",
      usedBy:[...value.usedBy]
    }))
    .sort((a,b)=>groceryAisleFor(a.item).localeCompare(groceryAisleFor(b.item))||a.item.localeCompare(b.item));
}

export async function POST(request:Request){
  if(!(await requireOwner()))return NextResponse.json({error:"Unauthorized"},{status:401});
  try{
    const body=await request.json() as {menuItems?:unknown};
    if(!Array.isArray(body.menuItems))return NextResponse.json({error:"Menu items are required"},{status:400});

    const menuItems:MenuItem[]=body.menuItems.slice(0,80).flatMap(raw=>{
      if(!raw||typeof raw!=="object")return[];
      const item=raw as Record<string,unknown>;
      const schedule=clean(item.schedule,80),videoId=clean(item.videoId,120),title=clean(item.title,250);
      const ingredients=Array.isArray(item.ingredients)?item.ingredients.map(v=>clean(v,500)).filter(Boolean).slice(0,80):[];
      const recipeMissing=item.recipeMissing===true||!ingredients.length;
      return schedule&&videoId&&title?[{schedule,videoId,title,ingredients,recipeMissing}]:[];
    });

    if(!menuItems.length)return NextResponse.json({error:"No menu items were supplied"},{status:400});

    const entries=buildCanonicalEntries(menuItems);
    let summary:SummaryItem[]=fallbackSummary(entries);

    if(process.env.OPENAI_API_KEY&&entries.length){
      try{
        const response=await fetch("https://api.openai.com/v1/responses",{
          method:"POST",
          headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,"Content-Type":"application/json"},
          body:JSON.stringify({
            model:"gpt-5.6-luna",
            reasoning:{effort:"none"},
            max_output_tokens:2600,
            input:[
              {role:"system",content:[{type:"input_text",text:[
                "Create ONE canonical grocery row per real grocery product from the supplied already-normalized ingredient entries.",
                "Never create duplicate rows for spelling, plural, preparation, OCR, or quantity variations of the same product.",
                "Examples that MUST merge: Spinach/baby spinach/washed spinach -> Spinach; Egg/eggs/large eggs -> Eggs; Mozzarella/mozzarella cheese -> Mozzarella; Chicken breast/boneless skinless chicken breast -> Chicken Breast; Cilantro/fresh cilantro/coriander leaves -> Cilantro.",
                "Do NOT merge genuinely different products such as Garlic vs Garlic Powder, Onion vs Onion Powder, Chicken Breast vs Chicken Thigh, or Milk vs Coconut Milk.",
                "Sum numeric quantities only when units are compatible and arithmetic is unambiguous. If quantities conflict or cannot be safely combined, use 'See recipes'. If no useful quantity exists, use an empty string.",
                "Never output 'As listed in recipes', 'Amount not specified', preparation words, OCR labels, or recipe section headings as grocery items or quantities.",
                "usedBy must be the unique scheduled menu items requiring that product."
              ].join("\n")}]} ,
              {role:"user",content:[{type:"input_text",text:JSON.stringify(entries)}]}
            ],
            text:{format:{type:"json_schema",name:"weekly_grocery_summary_v3",strict:true,schema:{type:"object",additionalProperties:false,properties:{summary:{type:"array",items:{type:"object",additionalProperties:false,properties:{item:{type:"string"},quantity:{type:"string"},usedBy:{type:"array",items:{type:"string"}}},required:["item","quantity","usedBy"]}}},required:["summary"]}}}
          }),
          signal:AbortSignal.timeout(45000)
        });
        if(response.ok){
          const data=await response.json() as {output?:Array<{content?:Array<{type?:string;text?:string}>}>};
          const text=data.output?.flatMap(item=>item.content??[]).find(item=>item.type==="output_text")?.text;
          if(text){
            const parsed=JSON.parse(text) as {summary?:SummaryItem[]};
            if(Array.isArray(parsed.summary)&&parsed.summary.length)summary=parsed.summary;
          }
        }
      }catch{}
    }

    summary=finalDedupe(summary);
    const aisleGroups=AISLE_ORDER.map(aisle=>({aisle,items:summary.filter(item=>groceryAisleFor(item.item)===aisle)})).filter(group=>group.items.length);

    return NextResponse.json({menuItems,summary,aisleGroups,generatedAt:new Date().toISOString(),normalizationVersion:"v3"});
  }catch{
    return NextResponse.json({error:"Could not generate grocery list"},{status:500});
  }
}
