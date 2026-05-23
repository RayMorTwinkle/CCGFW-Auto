import { parseJson } from "./tasks/common.mjs"

const STATUS_KEY = "status:v1"

export async function buildStatusResponse(env) {
  const status = await readStatus(env)
  return {
    ok: true,
    storage: Boolean(env.STATUS_KV),
    schedule: "北京时间每天 00:00 和 12:00",
    status,
  }
}

export async function saveStatus(env, action, result) {
  if (!env.STATUS_KV) return

  const previous = (await readStatus(env)) || {}
  const now = new Date().toISOString()
  const lastCheckin = result.checkin || (result.task === "checkin" ? result : null)
  const lastBuy = result.buy || (result.task === "buy" ? result : null)
  const trafficSnapshot = lastCheckin?.trafficInfo
    ? {
        traffic: lastCheckin.traffic,
        trafficInfo: lastCheckin.trafficInfo,
        message: lastCheckin.message,
        updatedAt: now,
      }
    : previous.trafficSnapshot || null

  const next = {
    ...previous,
    lastRunAt: now,
    lastAction: action,
    lastResult: compactResult(result),
    lastBuy: lastBuy ? compactResult(lastBuy) : previous.lastBuy || null,
    lastCheckin: lastCheckin ? compactResult(lastCheckin) : previous.lastCheckin || null,
    trafficSnapshot,
  }

  await env.STATUS_KV.put(STATUS_KEY, JSON.stringify(next))
}

async function readStatus(env) {
  if (!env.STATUS_KV) return null
  const text = await env.STATUS_KV.get(STATUS_KEY)
  return text ? parseJson(text) : null
}

function compactResult(result) {
  if (!result) return null
  if (result.order) {
    return {
      ok: result.ok,
      success: result.success,
      order: result.order,
      buy: compactResult(result.buy),
      checkin: compactResult(result.checkin),
    }
  }

  return {
    task: result.task,
    ok: result.ok,
    success: result.success,
    idempotent: result.idempotent,
    status: result.status,
    message: result.message,
    traffic: result.traffic,
    trafficInfo: result.trafficInfo,
  }
}
