export function baseHeaders(baseUrl, cookie, referer, hasBody = false) {
  const headers = {
    accept: "application/json, text/javascript, */*; q=0.01",
    "accept-language": "zh-CN,zh;q=0.9",
    cookie,
    dnt: "1",
    origin: baseUrl,
    referer,
    "user-agent":
      "Mozilla/5.0 (Linux; Android 6.0; Nexus 5 Build/MRA58N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Mobile Safari/537.36 Edg/148.0.0.0",
    "x-requested-with": "XMLHttpRequest",
  }

  if (hasBody) {
    headers["content-type"] = "application/x-www-form-urlencoded; charset=UTF-8"
  }

  return headers
}

export async function parseResponse(response) {
  const text = await response.text()
  const payload = parseJson(text)
  return {
    text,
    payload,
    message: payload?.msg || text || `HTTP ${response.status}`,
  }
}

export function getCookie(env) {
  return env.CCGFW_COOKIE?.trim()
}

export function missingCookieResult(task = "buy") {
  return {
    task,
    ok: false,
    success: false,
    idempotent: false,
    message: "Missing CCGFW_COOKIE secret.",
  }
}

export function normalizeBaseUrl(url) {
  return url.replace(/\/+$/, "")
}

export function parseJson(text) {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
