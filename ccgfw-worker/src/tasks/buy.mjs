import { baseHeaders, getCookie, missingCookieResult, normalizeBaseUrl, parseResponse } from "./common.mjs"

const IDEMPOTENT_MESSAGES = [
  "两次相同套餐购买间隔需要>1天",
  "重复购买",
  "已经购买",
]

export async function buy(env, config = {}) {
  const baseUrl = normalizeBaseUrl(config.baseUrl || env.CCGFW_BASE_URL || "https://www.okgg.top")
  const cookie = config.cookie || getCookie(env)
  if (!cookie) return missingCookieResult()

  const body = new URLSearchParams({
    coupon: config.coupon ?? env.CCGFW_COUPON ?? "",
    shop: config.shop || env.CCGFW_SHOP_ID || "8",
    autorenew: config.autorenew || env.CCGFW_AUTORENEW || "1",
    disableothers: config.disableothers || env.CCGFW_DISABLE_OTHERS || "1",
  })

  const response = await fetch(`${baseUrl}/user/buy`, {
    method: "POST",
    headers: baseHeaders(baseUrl, cookie, `${baseUrl}/user/shop`, true),
    body,
  })

  const parsed = await parseResponse(response)
  const success = response.ok && parsed.payload?.ret === 1
  const idempotent = response.ok && isIdempotentMessage(parsed.message)

  return {
    task: "buy",
    ok: response.ok,
    success,
    idempotent,
    status: response.status,
    message: parsed.message,
    baseUrl,
    shop: body.get("shop"),
    response: parsed.payload || parsed.text,
  }
}

function isIdempotentMessage(message) {
  return IDEMPOTENT_MESSAGES.some((item) => message.includes(item))
}
