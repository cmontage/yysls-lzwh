const SITE_TITLE_JS_ESCAPED = "\\u843d\\u5b50\\u65e0\\u6094\\uff01";
const SITE_TITLE_META_ENTITY = "&#33853;&#23376;&#26080;&#24724;&#65281;";
const DEFAULT_TARGET_URL =
  "https://ug.link/blackmyth/photo/share/?id=8&pagetype=share&uuid=88615bee-c594-4cc1-8826-252ae7bbb4ae";
const PROXY_VERSION = "2026-04-03-v5";

function rewriteToCustomDomain(raw, targetBaseUrl, currentOrigin) {
  if (!raw) return raw;
  try {
    const parsed = new URL(raw, targetBaseUrl);
    parsed.protocol = currentOrigin.protocol;
    parsed.host = currentOrigin.host;
    return parsed.toString();
  } catch {
    return raw;
  }
}

function rewriteBodyText(content, targetOrigin, currentOrigin) {
  const from = targetOrigin;
  const to = currentOrigin.origin;
  const fromEscaped = from.replace(/\//g, "\\/");
  const toEscaped = to.replace(/\//g, "\\/");

  return content
    .split(from)
    .join(to)
    .split(fromEscaped)
    .join(toEscaped);
}

function normalizeHeadersAfterRewrite(headers) {
  // Body text is reconstructed at edge; stale upstream metadata can break parsing.
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.delete("etag");
  headers.delete("last-modified");
  headers.delete("accept-ranges");
}

class UrlAttrRewriter {
  constructor(attr, targetBaseUrl, currentOrigin) {
    this.attr = attr;
    this.targetBaseUrl = targetBaseUrl;
    this.currentOrigin = currentOrigin;
  }

  element(element) {
    const value = element.getAttribute(this.attr);
    if (!value) return;
    if (/^(#|javascript:|data:|mailto:|tel:)/i.test(value)) {
      return;
    }
    const rewritten = rewriteToCustomDomain(value, this.targetBaseUrl, this.currentOrigin);
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
  responseHeaders.set("x-proxy-version", PROXY_VERSION);

  const contentType = responseHeaders.get("content-type") || "";
  const isHtml = contentType.includes("text/html");
  const isTextLike =
    isHtml ||
    contentType.includes("javascript") ||
    contentType.includes("json") ||
    contentType.startsWith("text/");

  if (!isTextLike) {
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  }

  const rawText = await upstreamResponse.text();
  const rewrittenText = rewriteBodyText(rawText, targetOrigin, currentOrigin);
  normalizeHeadersAfterRewrite(responseHeaders);

  if (!isHtml) {
    return new Response(rewrittenText, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  }

  // Force title and favicon on all HTML responses.
  const rewritten = new HTMLRewriter()
    .on("a[href]", new UrlAttrRewriter("href", upstreamUrl.toString(), currentOrigin))
    .on(
      "link[href]",
      new UrlAttrRewriter("href", upstreamUrl.toString(), currentOrigin)
    )
    .on(
      "script[src]",
      new UrlAttrRewriter("src", upstreamUrl.toString(), currentOrigin)
    )
    .on("img[src]", new UrlAttrRewriter("src", upstreamUrl.toString(), currentOrigin))
    .on(
      "iframe[src]",
      new UrlAttrRewriter("src", upstreamUrl.toString(), currentOrigin)
    )
    .on(
      "source[src]",
      new UrlAttrRewriter("src", upstreamUrl.toString(), currentOrigin)
    )
    .on(
      "form[action]",
      new UrlAttrRewriter("action", upstreamUrl.toString(), currentOrigin)
    )
    .on("head", {
      element(element) {
        element.append(
          `<base href="${targetPathPrefix}" />\n<link rel="icon" href="/favicon.ico" />\n<meta name="apple-mobile-web-app-title" content="${SITE_TITLE_META_ENTITY}" />\n<script>(function(){var t='${SITE_TITLE_JS_ESCAPED}';function setMeta(){document.title=t;var icon=document.querySelector('link[rel~="icon"]');if(!icon){icon=document.createElement('link');icon.setAttribute('rel','icon');document.head.appendChild(icon);}icon.setAttribute('href','/favicon.ico');}setMeta();new MutationObserver(setMeta).observe(document.documentElement,{subtree:true,childList:true});})();</script>`,
          { html: true }
        );
      },
    })
    .transform(
      new Response(rewrittenText, {
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText,
        headers: responseHeaders,
      })
    );

  return rewritten;
}
