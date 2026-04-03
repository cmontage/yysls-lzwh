const SITE_TITLE_JS_ESCAPED = "\\u843d\\u5b50\\u65e0\\u6094\\uff01";
const SITE_TITLE_META_ENTITY = "&#33853;&#23376;&#26080;&#24724;&#65281;";
const DEFAULT_TARGET_URL =
  "https://ug.link/blackmyth/photo/share/?id=8&pagetype=share&uuid=88615bee-c594-4cc1-8826-252ae7bbb4ae";
const PROXY_VERSION = "2026-04-03-v8";
const DEFAULT_PROXY_HOSTS = [
  "api.ugnas.com",
  "web.ugnas.com",
  "cloud.ugreengroup.com",
  "cloud.ugnas.com",
];
const PROXY_PREFIX = "/__proxy/";

function parseProxyHosts(value) {
  if (!value) return [];
  return value
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

function isSafeProxyHost(hostname) {
  return /^[a-z0-9.-]+$/.test(hostname);
}

function collectHostVariants(hostname) {
  const set = new Set();
  if (!hostname) return set;
  const host = hostname.toLowerCase();
  const hostNoWww = host.replace(/^www\./i, "");
  set.add(hostNoWww);
  set.add(`www.${hostNoWww}`);
  return set;
}

function replaceAllLiteral(content, from, to) {
  if (!from || from === to) return content;
  const fromEscaped = from.replace(/\//g, "\\/");
  const toEscaped = to.replace(/\//g, "\\/");
  return content.split(from).join(to).split(fromEscaped).join(toEscaped);
}

function buildReplacementPairs(currentOrigin, primaryHostSet, proxyHostSet) {
  const pairs = [];
  for (const host of primaryHostSet) {
    pairs.push([`https://${host}`, currentOrigin.origin]);
    pairs.push([`http://${host}`, currentOrigin.origin]);
  }
  for (const host of proxyHostSet) {
    if (primaryHostSet.has(host)) continue;
    const proxyBase = `${currentOrigin.origin}${PROXY_PREFIX}${host}`;
    pairs.push([`https://${host}`, proxyBase]);
    pairs.push([`http://${host}`, proxyBase]);
  }
  return pairs;
}

function rewriteBodyText(content, replacementPairs) {
  let out = content;
  for (const [from, to] of replacementPairs) {
    out = replaceAllLiteral(out, from, to);
  }
  return out;
}

function normalizeHeadersAfterRewrite(headers) {
  // Body text is reconstructed at edge; stale upstream metadata can break parsing.
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.delete("etag");
  headers.delete("last-modified");
  headers.delete("accept-ranges");
  headers.set("cache-control", "no-store");
}

class UrlAttrRewriter {
  constructor(attr, targetBaseUrl, currentOrigin, primaryHostSet, proxyHostSet) {
    this.attr = attr;
    this.targetBaseUrl = targetBaseUrl;
    this.currentOrigin = currentOrigin;
    this.primaryHostSet = primaryHostSet;
    this.proxyHostSet = proxyHostSet;
  }

  element(element) {
    const value = element.getAttribute(this.attr);
    if (!value) return;
    if (/^(#|javascript:|data:|mailto:|tel:)/i.test(value)) {
      return;
    }

    let rewritten = value;
    try {
      const parsed = new URL(value, this.targetBaseUrl);
      if (parsed.host === this.currentOrigin.host) {
        rewritten = parsed.toString();
      } else if (this.primaryHostSet.has(parsed.hostname.toLowerCase())) {
        parsed.protocol = this.currentOrigin.protocol;
        parsed.host = this.currentOrigin.host;
        rewritten = parsed.toString();
      } else if (this.proxyHostSet.has(parsed.hostname.toLowerCase())) {
        rewritten = `${this.currentOrigin.origin}${PROXY_PREFIX}${parsed.hostname}${parsed.pathname}${parsed.search}${parsed.hash}`;
      }
    } catch {
      rewritten = value;
    }

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

  const currentOrigin = new URL(url.origin);
  const primaryHostSet = collectHostVariants(target.hostname);
  const proxyHostSet = new Set([
    ...DEFAULT_PROXY_HOSTS,
    ...parseProxyHosts(env.PROXY_HOSTS),
  ]);

  let upstreamUrl;
  if (url.pathname.startsWith(PROXY_PREFIX)) {
    const rest = url.pathname.slice(PROXY_PREFIX.length);
    const slashIndex = rest.indexOf("/");
    const host = (slashIndex === -1 ? rest : rest.slice(0, slashIndex)).toLowerCase();
    const path = slashIndex === -1 ? "/" : `/${rest.slice(slashIndex + 1)}`;

    if (!host || !isSafeProxyHost(host)) {
      return new Response("Invalid proxy host.", { status: 400 });
    }

    if (!proxyHostSet.has(host) && !primaryHostSet.has(host)) {
      return new Response("Proxy host is not allowed.", { status: 403 });
    }

    upstreamUrl = new URL(path + url.search, `https://${host}`);
  } else {
    const targetOrigin = target.origin;
    upstreamUrl =
      url.pathname === "/" || url.pathname === "/index.html"
        ? new URL(target.toString())
        : new URL(url.pathname + url.search, targetOrigin);

    if ((url.pathname === "/" || url.pathname === "/index.html") && url.search) {
      upstreamUrl.search = url.search;
    }
  }

  const upstreamOrigin = upstreamUrl.origin;
  const upstreamHost = upstreamUrl.host;

  const upstreamHeaders = new Headers(request.headers);
  upstreamHeaders.set("Host", upstreamHost);
  upstreamHeaders.set("Origin", upstreamOrigin);
  upstreamHeaders.set("Referer", upstreamOrigin + "/");
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
  const upstreamFinalOrigin = new URL(upstreamResponse.url).origin;
  const upstreamFinalHost = new URL(upstreamResponse.url).hostname.toLowerCase();

  for (const host of collectHostVariants(upstreamFinalHost)) {
    if (!primaryHostSet.has(host)) {
      proxyHostSet.add(host);
    }
  }

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
  for (const host of collectHostVariants(target.hostname)) {
    primaryHostSet.add(host);
  }
  for (const host of collectHostVariants(new URL(upstreamFinalOrigin).hostname)) {
    primaryHostSet.add(host);
  }

  const rewrittenText = rewriteBodyText(
    rawText,
    buildReplacementPairs(currentOrigin, primaryHostSet, proxyHostSet)
  );
  normalizeHeadersAfterRewrite(responseHeaders);

  if (!isHtml) {
    return new Response(rewrittenText, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    });
  }

  const targetPathPrefix = upstreamUrl.pathname.endsWith("/")
    ? upstreamUrl.pathname
    : upstreamUrl.pathname.slice(0, upstreamUrl.pathname.lastIndexOf("/") + 1) || "/";

  // Force title and favicon on all HTML responses.
  const rewritten = new HTMLRewriter()
    .on(
      "a[href]",
      new UrlAttrRewriter(
        "href",
        upstreamUrl.toString(),
        currentOrigin,
        primaryHostSet,
        proxyHostSet
      )
    )
    .on(
      "link[href]",
      new UrlAttrRewriter(
        "href",
        upstreamUrl.toString(),
        currentOrigin,
        primaryHostSet,
        proxyHostSet
      )
    )
    .on(
      "script[src]",
      new UrlAttrRewriter(
        "src",
        upstreamUrl.toString(),
        currentOrigin,
        primaryHostSet,
        proxyHostSet
      )
    )
    .on(
      "img[src]",
      new UrlAttrRewriter(
        "src",
        upstreamUrl.toString(),
        currentOrigin,
        primaryHostSet,
        proxyHostSet
      )
    )
    .on(
      "iframe[src]",
      new UrlAttrRewriter(
        "src",
        upstreamUrl.toString(),
        currentOrigin,
        primaryHostSet,
        proxyHostSet
      )
    )
    .on(
      "source[src]",
      new UrlAttrRewriter(
        "src",
        upstreamUrl.toString(),
        currentOrigin,
        primaryHostSet,
        proxyHostSet
      )
    )
    .on(
      "form[action]",
      new UrlAttrRewriter(
        "action",
        upstreamUrl.toString(),
        currentOrigin,
        primaryHostSet,
        proxyHostSet
      )
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
