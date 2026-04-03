const SITE_TITLE = "落子无悔！";
const DEFAULT_TARGET_URL =
  "https://ug.link/blackmyth/photo/share/?id=8&pagetype=share&uuid=88615bee-c594-4cc1-8826-252ae7bbb4ae";

function rewriteToCustomDomain(raw, targetOrigin, currentOrigin) {
  if (!raw) return raw;
  try {
    const parsed = new URL(raw, targetOrigin);
    parsed.protocol = currentOrigin.protocol;
    parsed.host = currentOrigin.host;
    return parsed.toString();
  } catch {
    return raw;
  }
}

class UrlAttrRewriter {
  constructor(attr, targetOrigin, currentOrigin) {
    this.attr = attr;
    this.targetOrigin = targetOrigin;
    this.currentOrigin = currentOrigin;
  }

  element(element) {
    const value = element.getAttribute(this.attr);
    if (!value) return;
    const rewritten = rewriteToCustomDomain(value, this.targetOrigin, this.currentOrigin);
    if (rewritten && rewritten !== value) {
      element.setAttribute(this.attr, rewritten);
    }
  }
}

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
  const currentOrigin = new URL(url.origin);
  const targetPathPrefix = target.pathname.endsWith("/")
    ? target.pathname
    : target.pathname + "/";
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
    redirect: "follow",
  });

  const upstreamResponse = await fetch(upstreamRequest);

  const responseHeaders = new Headers(upstreamResponse.headers);

  // Remove frame restrictions that can break embedded resources.
  responseHeaders.delete("x-frame-options");
  responseHeaders.delete("frame-options");
  responseHeaders.delete("content-security-policy");
  responseHeaders.delete("content-security-policy-report-only");

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
    .on("a[href]", new UrlAttrRewriter("href", targetOrigin, currentOrigin))
    .on("link[href]", new UrlAttrRewriter("href", targetOrigin, currentOrigin))
    .on("script[src]", new UrlAttrRewriter("src", targetOrigin, currentOrigin))
    .on("img[src]", new UrlAttrRewriter("src", targetOrigin, currentOrigin))
    .on("iframe[src]", new UrlAttrRewriter("src", targetOrigin, currentOrigin))
    .on("source[src]", new UrlAttrRewriter("src", targetOrigin, currentOrigin))
    .on("form[action]", new UrlAttrRewriter("action", targetOrigin, currentOrigin))
    .on("title", {
      text(text) {
        text.replace(SITE_TITLE);
      },
    })
    .on("head", {
      element(element) {
        element.append(
          `<base href="${targetPathPrefix}" />\n<link rel="icon" href="/favicon.ico" />\n<meta name="apple-mobile-web-app-title" content="落子无悔！" />\n<script>(function(){var t=${JSON.stringify(
            SITE_TITLE
          )};function setMeta(){document.title=t;var icon=document.querySelector('link[rel~="icon"]');if(!icon){icon=document.createElement('link');icon.setAttribute('rel','icon');document.head.appendChild(icon);}icon.setAttribute('href','/favicon.ico');}setMeta();new MutationObserver(setMeta).observe(document.documentElement,{subtree:true,childList:true});})();</script>`,
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
