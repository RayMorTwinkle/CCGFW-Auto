import { buy } from "./buy.mjs"
import { checkin } from "./checkin.mjs"

export function routeAction(pathname) {
  if (pathname === "/run" || pathname === "/api/run") return "all"
  if (pathname === "/buy" || pathname === "/api/buy") return "buy"
  if (pathname === "/checkin" || pathname === "/api/checkin") return "checkin"
  return null
}

export async function runAction(action, env) {
  if (action === "buy") return buy(env)
  if (action === "checkin") return checkin(env)
  return runAll(env)
}

export async function runAll(env) {
  const buyResult = await buy(env)
  const checkinResult = await checkin(env)

  return {
    ok: buyResult.ok && checkinResult.ok,
    success:
      Boolean(buyResult.success || buyResult.idempotent) &&
      Boolean(checkinResult.success || checkinResult.idempotent),
    order: ["buy", "checkin"],
    buy: buyResult,
    checkin: checkinResult,
  }
}
