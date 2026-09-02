import { NextRequest, NextResponse } from "next/server";

function youtubeId(rawUrl: string) {
  try {
    const url = new URL(rawUrl);
    if (url.hostname === "youtu.be") return url.pathname.split("/").filter(Boolean)[0];
    if (url.pathname.startsWith("/shorts/")) return url.pathname.split("/")[2];
    return url.searchParams.get("v");
  } catch { return null; }
}

export async function GET(request: NextRequest) {
  const rawUrl = request.nextUrl.searchParams.get("url");
  if (!rawUrl) return NextResponse.json({ error: "Missing URL" }, { status: 400 });

  const videoId = youtubeId(rawUrl);
  if (videoId) return NextResponse.json({ thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` }, { headers: { "Cache-Control": "public, max-age=86400, s-maxage=604800" } });

  try {
    const target = new URL(rawUrl);
    if (!["http:", "https:"].includes(target.protocol)) throw new Error("Unsupported URL");
    const allowed = ["instagram.com", "www.instagram.com", "facebook.com", "www.facebook.com", "fb.watch"];
    if (!allowed.includes(target.hostname)) throw new Error("Unsupported host");
    const response = await fetch(target, { redirect: "follow", headers: { "User-Agent": "Mozilla/5.0 (compatible; RecipeReelLibrary/1.0)", "Accept-Language": "en-US,en;q=0.9" }, signal: AbortSignal.timeout(7000) });
    if (!response.ok) throw new Error("Metadata unavailable");
    const html = await response.text();
    const match = html.match(/<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']/i) ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image["']/i);
    if (!match?.[1]) throw new Error("Thumbnail unavailable");
    return NextResponse.json({ thumbnail: match[1].replace(/&amp;/g, "&") }, { headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400" } });
  } catch {
    return NextResponse.json({ thumbnail: null }, { status: 404, headers: { "Cache-Control": "public, max-age=900" } });
  }
}
