import { normalizeBaseUrl, parseJson } from "./tasks/common.mjs"

const CONFIG_KEY = "config:v1"
const PROFILE_LIMIT = 3

export async function getRuntimeConfig(env) {
  const stored = await readConfig(env)
  const active = stored?.profiles?.find((profile) => profile.id === stored.activeId) || stored?.profiles?.[0]

  return {
    baseUrl: normalizeBaseUrl(active?.baseUrl || env.CCGFW_BASE_URL || "https://www.okgg.top"),
    cookie: active?.cookie || env.CCGFW_COOKIE || "",
    shop: active?.shop || env.CCGFW_SHOP_ID || "8",
    coupon: active?.coupon ?? env.CCGFW_COUPON ?? "",
    autorenew: active?.autorenew || env.CCGFW_AUTORENEW || "1",
    disableothers: active?.disableothers || env.CCGFW_DISABLE_OTHERS || "1",
    source: active ? "kv" : "env",
    profile: active ? maskProfile(active) : null,
  }
}

export async function buildConfigResponse(env) {
  const config = await readConfig(env)
  return {
    ok: true,
    config: sanitizeConfig(config),
  }
}

export async function saveCurlConfig(env, curlText) {
  if (!env.STATUS_KV) {
    return { ok: false, message: "STATUS_KV is not bound." }
  }

  const parsed = parseCurl(curlText)
  const now = new Date().toISOString()
  const previous = (await readConfig(env)) || { activeId: null, profiles: [] }
  const id = `${new URL(parsed.baseUrl).hostname}-${Date.now()}`
  const profile = {
    id,
    baseUrl: parsed.baseUrl,
    cookie: parsed.cookie,
    shop: parsed.shop || "8",
    coupon: parsed.coupon ?? "",
    autorenew: parsed.autorenew || "1",
    disableothers: parsed.disableothers || "1",
    createdAt: now,
    updatedAt: now,
  }

  const profiles = [
    profile,
    ...(previous.profiles || []).filter((item) => item.cookie !== profile.cookie || item.baseUrl !== profile.baseUrl),
  ].slice(0, PROFILE_LIMIT)

  const next = {
    activeId: profile.id,
    profiles,
    updatedAt: now,
  }

  await env.STATUS_KV.put(CONFIG_KEY, JSON.stringify(next))

  return {
    ok: true,
    active: maskProfile(profile),
    config: sanitizeConfig(next),
  }
}

export async function activateProfile(env, id) {
  if (!env.STATUS_KV) {
    return { ok: false, message: "STATUS_KV is not bound." }
  }

  const config = await readConfig(env)
  const profile = config?.profiles?.find((item) => item.id === id)
  if (!profile) {
    return { ok: false, message: "Profile not found." }
  }

  const next = {
    ...config,
    activeId: id,
    updatedAt: new Date().toISOString(),
  }
  await env.STATUS_KV.put(CONFIG_KEY, JSON.stringify(next))

  return {
    ok: true,
    active: maskProfile(profile),
    config: sanitizeConfig(next),
  }
}

export async function readConfig(env) {
  if (!env.STATUS_KV) return null
  const text = await env.STATUS_KV.get(CONFIG_KEY)
  return text ? parseJson(text) : null
}

function parseCurl(curlText) {
  const text = String(curlText || "").trim()
  if (!text) throw new Error("curl 内容为空")

  const url = extractUrl(text)
  const parsedUrl = new URL(url)
  const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}`
  const cookie = extractCookie(text)
  if (!cookie) throw new Error("没有解析到 Cookie")

  const form = new URLSearchParams(extractData(text))
  return {
    baseUrl,
    cookie,
    shop: form.get("shop") || "8",
    coupon: form.get("coupon") ?? "",
    autorenew: form.get("autorenew") || "1",
    disableothers: form.get("disableothers") || "1",
  }
}

function extractUrl(text) {
  const match = text.match(/curl\s+(?:--location\s+)?(?:'([^']+)'|"([^"]+)"|(\S+))/)
  const url = match?.[1] || match?.[2] || match?.[3]
  if (!url || !url.startsWith("http")) throw new Error("没有解析到请求 URL")
  return url
}

function extractCookie(text) {
  const cookieArg = matchOption(text, "-b") || matchOption(text, "--cookie")
  if (cookieArg) return cookieArg

  const headerCookie = text.match(/-H\s+(?:'cookie:\s*([^']+)'|"cookie:\s*([^"]+)")/i)
  return headerCookie?.[1] || headerCookie?.[2] || ""
}

function extractData(text) {
  return matchOption(text, "--data-raw") || matchOption(text, "--data") || matchOption(text, "-d") || ""
}

function matchOption(text, option) {
  const escaped = option.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const regex = new RegExp(`${escaped}\\s+(?:'([^']*)'|"([^"]*)"|(\\S+))`)
  const match = text.match(regex)
  return match?.[1] ?? match?.[2] ?? match?.[3] ?? ""
}

function sanitizeConfig(config) {
  if (!config) return null
  return {
    activeId: config.activeId,
    updatedAt: config.updatedAt,
    profiles: (config.profiles || []).map(maskProfile),
  }
}

function maskProfile(profile) {
  return {
    id: profile.id,
    baseUrl: profile.baseUrl,
    cookiePreview: maskCookie(profile.cookie),
    shop: profile.shop,
    coupon: profile.coupon,
    autorenew: profile.autorenew,
    disableothers: profile.disableothers,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
  }
}

function maskCookie(cookie) {
  if (!cookie) return ""
  return cookie.length > 18 ? `${cookie.slice(0, 10)}...${cookie.slice(-6)}` : "***"
}
