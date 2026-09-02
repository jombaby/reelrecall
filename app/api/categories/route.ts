import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";

export async function GET() {
  if (!(await requireOwner())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await db()`SELECT c.id,c.name,c.parent_id AS "parentId",p.name AS "parentName"
    FROM categories c LEFT JOIN categories p ON p.id=c.parent_id
    WHERE c.owner_id='owner' ORDER BY COALESCE(p.name,c.name),c.parent_id NULLS FIRST,c.name`;
  return NextResponse.json(rows);
}

export async function POST(request: Request) {
  if (!(await requireOwner())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { name, parentId = null } = await request.json();
  if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  try {
    const rows = await db()`INSERT INTO categories(owner_id,name,parent_id) VALUES('owner',${name.trim()},${parentId})
      RETURNING id,name,parent_id AS "parentId"`;
    return NextResponse.json(rows[0], { status: 201 });
  } catch {
    return NextResponse.json({ error: "That category already exists" }, { status: 409 });
  }
}

export async function DELETE(request: Request) {
  if (!(await requireOwner())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
  await db()`DELETE FROM categories WHERE id=${id} AND owner_id='owner'`;
  return new NextResponse(null, { status: 204 });
}
