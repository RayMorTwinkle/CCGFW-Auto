import { baseHeaders, getCookie, missingCookieResult, normalizeBaseUrl, parseResponse } from "./common.mjs"

export async function checkin(env, config = {}) {
  const baseUrl = normalizeBaseUrl(config.baseUrl || env.CCGFW_BASE_URL || "https://www.okgg.top")
  const cookie = config.cookie || getCookie(env)
  if (!cookie) return missingCookieResult("checkin")

  const response = await fetch(`${baseUrl}/user/checkin`, {
    method: "POST",
    headers: baseHeaders(baseUrl, cookie, `${baseUrl}/user`),
  })

  const parsed = await parseResponse(response)
  const success = response.ok && parsed.payload?.ret === 1
  const idempotent = response.ok && isCheckinIdempotentMessage(parsed.message)

  return {
    task: "checkin",
    ok: response.ok,
    success,
    idempotent,
    status: response.status,
    message: parsed.message,
    baseUrl,
    traffic: parsed.payload?.traffic,
    trafficInfo: parsed.payload?.trafficInfo,
    response: parsed.payload || parsed.text,
  }
}

function isCheckinIdempotentMessage(message) {
  return message.includes("已签到") || message.includes("已经签到") || message.includes("明天再来")
}
