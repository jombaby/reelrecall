import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";
import { normalizeUrl, RecipeInput, sourceFor } from "@/lib/recipes";

const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });

export async function GET() {
  if (!(await requireOwner())) return unauthorized();
  const rows = await db()`
    SELECT id, title, url, source, category, subcategory, tags, notes, favorite,
      unavailable, category_manual AS "categoryManual", tags_manual AS "tagsManual",
      message_at AS "messageAt", added_at AS "addedAt"
    FROM reels WHERE owner_id='owner'
    ORDER BY COALESCE(message_at, added_at) DESC, added_at DESC`;
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  if (!(await requireOwner())) return unauthorized();
  const body = await request.json();
  const entries: RecipeInput[] = Array.isArray(body) ? body : [body];
  let added = 0;
  let duplicates = 0;
  for (const item of entries) {
    if (!item.url) continue;
    const normalized = normalizeUrl(item.url);
    const result = await db()`
      INSERT INTO reels (owner_id,title,url,normalized_url,source,category,subcategory,tags,notes,favorite,unavailable,category_manual,tags_manual,message_at,added_at)
      VALUES ('owner', ${item.title?.trim() || `${sourceFor(item.url)} reel`}, ${item.url}, ${normalized},
        ${item.source || sourceFor(item.url)}, ${item.category || 'Uncategorized'}, ${item.subcategory || ''},
        ${item.tags || []}, ${item.notes || ''}, ${item.favorite || false}, ${item.unavailable || false},
        ${item.categoryManual || false}, ${item.tagsManual || false}, ${item.messageAt || null}, ${item.addedAt || new Date().toISOString()})
      ON CONFLICT (owner_id, normalized_url) DO NOTHING RETURNING id`;
    if (result.length) added++; else duplicates++;
  }
  return NextResponse.json({ added, duplicates }, { status: added ? 201 : 200 });
}
