const SITE_TITLE = "落子无悔！";
const DEFAULT_TARGET_URL =
  "https://ug.link/blackmyth/photo/share/?id=8&pagetype=share&uuid=88615bee-c594-4cc1-8826-252ae7bbb4ae";

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  // Keep local static favicon from the project root.
  if (url.pathname === "/favicon.ico") {
    return context.next();
  }

  const targetUrl = env.TARGET_URL || DEFAULT_TARGET_URL;

  let target;
  try {
    target = new URL(targetUrl);
  } catch {
    return new Response("TARGET_URL is invalid.", { status: 500 });
  }

  const targetOrigin = target.origin;
  const upstreamUrl =
    url.pathname === "/" || url.pathname === "/index.html"
      ? new URL(target.toString())
      : new URL(url.pathname + url.search, targetOrigin);

  if ((url.pathname === "/" || url.pathname === "/index.html") && url.search) {
    upstreamUrl.search = url.search;
  }

  const upstreamHeaders = new Headers(request.headers);
  upstreamHeaders.set("Host", target.host);
  upstreamHeaders.set("Origin", targetOrigin);
  upstreamHeaders.set("Referer", targetOrigin + "/");
  upstreamHeaders.delete("cf-connecting-ip");
  upstreamHeaders.delete("x-forwarded-for");
  upstreamHeaders.delete("x-real-ip");

  const upstreamRequest = new Request(upstreamUrl.toString(), {
    method: request.method,
    headers: upstreamHeaders,
    body: request.body,
    redirect: "manual",
  });

  const upstreamResponse = await fetch(upstreamRequest);

  const responseHeaders = new Headers(upstreamResponse.headers);

  // Keep the custom domain visible by rewriting upstream redirects.
  const location = responseHeaders.get("location");
  if (location) {
    try {
      const redirectURL = new URL(location, targetOrigin);
      if (redirectURL.origin === targetOrigin) {
        redirectURL.protocol = url.protocol;
        redirectURL.host = url.host;
        responseHeaders.set("location", redirectURL.toString());
      }
    } catch {
      // Ignore malformed location and keep original.
    }
  }

  // Remove frame restrictions that can break embedded resources.
  responseHeaders.delete("x-frame-options");
  responseHeaders.delete("frame-options");

  const contentType = responseHeaders.get("content-type") || "";
  if (!contentType.includes("text/html")) {
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  }

  // Force title and favicon on all HTML responses.
  const rewritten = new HTMLRewriter()
    .on("title", {
      text(text) {
        text.replace(SITE_TITLE);
      },
    })
    .on("head", {
      element(element) {
        element.append(
          '<link rel="icon" href="/favicon.ico" />\n<meta name="apple-mobile-web-app-title" content="落子无悔！" />',
          { html: true }
        );
      },
    })
    .transform(
      new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
      })
    );

  return rewritten;
}
