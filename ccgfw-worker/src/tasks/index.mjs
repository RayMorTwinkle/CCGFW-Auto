import { buy } from "./buy.mjs"
import { checkin } from "./checkin.mjs"
import { getRuntimeConfig } from "../config.mjs"

export function routeAction(pathname) {
  if (pathname === "/run" || pathname === "/api/run") return "all"
  if (pathname === "/buy" || pathname === "/api/buy") return "buy"
  if (pathname === "/checkin" || pathname === "/api/checkin") return "checkin"
  return null
}

export async function runAction(action, env) {
  const config = await getRuntimeConfig(env)
  if (action === "buy") return buy(env, config)
  if (action === "checkin") return checkin(env, config)
  return runAll(env)
}

export async function runAll(env) {
  const config = await getRuntimeConfig(env)
  const buyResult = await buy(env, config)
  const checkinResult = await checkin(env, config)

  return {
    ok: buyResult.ok && checkinResult.ok,
    success:
      Boolean(buyResult.success || buyResult.idempotent) &&
      Boolean(checkinResult.success || checkinResult.idempotent),
    order: ["buy", "checkin"],
    config: config.profile,
    buy: buyResult,
    checkin: checkinResult,
  }
}
