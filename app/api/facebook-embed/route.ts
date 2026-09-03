import { NextRequest, NextResponse } from "next/server";

const FACEBOOK_HOSTS = new Set([
  "facebook.com",
  "www.facebook.com",
  "m.facebook.com",
  "fb.watch",
]);

function isFacebookUrl(raw: string) {
  try {
    const url = new URL(raw);
    return ["http:", "https:"].includes(url.protocol) && FACEBOOK_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isUsableFacebookDestination(raw: string) {
  try {
    const url = new URL(raw);
    if (!FACEBOOK_HOSTS.has(url.hostname.toLowerCase())) return false;
    const path = url.pathname.toLowerCase();
    return !path.startsWith("/login") && !path.startsWith("/checkpoint");
  } catch {
    return false;
  }
}

async function resolveFacebookShareUrl(raw: string) {
  const parsed = new URL(raw);
  const shouldResolve = parsed.hostname === "fb.watch" || parsed.hostname === "m.facebook.com" || parsed.pathname.startsWith("/share/");
  if (!shouldResolve) return raw;

  try {
    const response = await fetch(raw, {
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ReelRecall/2.0)",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(6000),
    });

    if (isUsableFacebookDestination(response.url)) return response.url;

    if (response.ok) {
      const html = await response.text();
      const canonical = html.match(/<meta[^>]+(?:property|name)=["']og:url["'][^>]+content=["']([^"']+)["']/i)?.[1]
        ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:url["']/i)?.[1];
      if (canonical && isUsableFacebookDestination(canonical.replace(/&amp;/g, "&"))) return canonical.replace(/&amp;/g, "&");
    }
  } catch {
    // Keep the original URL. Meta oEmbed may still understand it.
  }

  return raw;
}

function stripScripts(html: string) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "").trim();
}

async function fetchOEmbed(url: string) {
  const endpoint = new URL("https://graph.facebook.com/v25.0/oembed_video");
  endpoint.searchParams.set("url", url);
  endpoint.searchParams.set("omitscript", "true");
  endpoint.searchParams.set("maxwidth", "500");

  const response = await fetch(endpoint, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return null;

  const data = await response.json() as { html?: string; width?: number; height?: number; title?: string };
  if (!data.html) return null;
  return {
    html: stripScripts(data.html),
    width: data.width ?? null,
    height: data.height ?? null,
    title: data.title ?? null,
  };
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("url");
  if (!raw) return NextResponse.json({ error: "Missing URL" }, { status: 400 });
  if (!isFacebookUrl(raw)) return NextResponse.json({ error: "Unsupported host" }, { status: 400 });

  const resolvedUrl = await resolveFacebookShareUrl(raw);
  const candidates = resolvedUrl === raw ? [raw] : [resolvedUrl, raw];

  for (const candidate of candidates) {
    try {
      const embed = await fetchOEmbed(candidate);
      if (embed) {
        return NextResponse.json(
          { state: "embeddable", resolvedUrl: candidate, ...embed },
          { headers: { "Cache-Control": "public, max-age=600, s-maxage=1800" } },
        );
      }
    } catch {
      // Try the next candidate, then fall back to opening Facebook directly.
    }
  }

  // An oEmbed rejection does NOT prove that the reel was deleted. It can also
  // mean login, audience, geographic, age, or embed restrictions.
  return NextResponse.json(
    { state: "external", resolvedUrl },
    { status: 404, headers: { "Cache-Control": "public, max-age=300" } },
  );
}
