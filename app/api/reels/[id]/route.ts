import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";
import { normalizeUrl, sourceFor } from "@/lib/recipes";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await requireOwner())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  const item = await request.json();
  const current = await db()`SELECT * FROM reels WHERE id=${id} AND owner_id='owner'`;
  if (!current.length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const old = current[0];
  const url = item.url ?? old.url;
  try {
    const rows = await db()`UPDATE reels SET
      title=${item.title ?? old.title}, url=${url}, normalized_url=${normalizeUrl(url)}, source=${sourceFor(url)},
      category=${item.category ?? old.category}, subcategory=${item.subcategory ?? old.subcategory},
      tags=${item.tags ?? old.tags}, notes=${item.notes ?? old.notes}, favorite=${item.favorite ?? old.favorite},
      unavailable=${item.unavailable ?? old.unavailable},
      category_manual=${item.category !== undefined ? true : old.category_manual},
      tags_manual=${item.tags !== undefined ? true : old.tags_manual}, updated_at=now()
      WHERE id=${id} AND owner_id='owner'
      RETURNING id, title, url, source, category, subcategory, tags, notes, favorite, unavailable,
        category_manual AS "categoryManual", tags_manual AS "tagsManual", message_at AS "messageAt", added_at AS "addedAt"`;
    return NextResponse.json(rows[0]);
  } catch (error) {
    if (String(error).includes("unique")) return NextResponse.json({ error: "That reel is already saved" }, { status: 409 });
    throw error;
  }
}

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  if (!(await requireOwner())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await context.params;
  await db()`DELETE FROM reels WHERE id=${id} AND owner_id='owner'`;
  return new NextResponse(null, { status: 204 });
}
