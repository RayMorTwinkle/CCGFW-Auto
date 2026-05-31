import { html, json } from "./http.mjs"
import { activateProfile, buildConfigResponse, saveCurlConfig } from "./config.mjs"
import { renderStatusPage } from "./routes/page.mjs"
import { buildStatusResponse, saveStatus } from "./storage.mjs"
import { routeAction, runAction, runAll } from "./tasks/index.mjs"

export default {
  async fetch(request, env) {
    const url = new URL(request.url)

    if (url.pathname === "/health") {
      return json({ ok: true })
    }

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/status")) {
      return html(renderStatusPage())
    }

    if (request.method === "GET" && url.pathname === "/api/status") {
      return json(await buildStatusResponse(env))
    }

    if (request.method === "GET" && url.pathname === "/api/config") {
      return json(await buildConfigResponse(env))
    }

    if (request.method === "POST" && url.pathname === "/api/curl") {
      try {
        const curlText = await request.text()
        return json(await saveCurlConfig(env, curlText))
      } catch (error) {
        return json({ ok: false, message: error.message || String(error) }, 400)
      }
    }

    if (request.method === "POST" && url.pathname === "/api/profiles/activate") {
      try {
        const body = await request.json()
        const result = await activateProfile(env, body.id)
        return json(result, result.ok ? 200 : 404)
      } catch (error) {
        return json({ ok: false, message: error.message || String(error) }, 400)
      }
    }

    const action = routeAction(url.pathname)
    if (!action) {
      return json({ ok: false, message: "Use /, /api/status, POST /run, /buy, or /checkin." }, 404)
    }

    if (request.method !== "POST") {
      return json({ ok: false, message: "Method not allowed." }, 405)
    }

    const result = await runAction(action, env)
    await saveStatus(env, action, result)
    return json(result, result.ok ? 200 : 502)
  },

  async scheduled(_controller, env, _ctx) {
    const result = await runAll(env)
    await saveStatus(env, "all", result)
    console.log("CCGFW scheduled result:", JSON.stringify(result))
  },
}
