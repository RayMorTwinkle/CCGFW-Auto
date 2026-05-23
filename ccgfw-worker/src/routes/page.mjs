export function renderStatusPage() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>CCGFW 自动任务</title>
  <style>
    :root { color-scheme: light; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { margin: 0; background: #f6f7f9; color: #20242a; }
    main { max-width: 980px; margin: 0 auto; padding: 28px 18px 44px; }
    h1 { margin: 0 0 18px; font-size: 28px; letter-spacing: 0; }
    h2 { margin: 0 0 12px; font-size: 17px; letter-spacing: 0; }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
    .panel, .card { background: #fff; border: 1px solid #dde1e7; border-radius: 8px; padding: 16px; }
    .panel { margin-bottom: 14px; }
    .label { color: #667085; font-size: 13px; margin-bottom: 6px; }
    .value { font-size: 24px; font-weight: 700; overflow-wrap: anywhere; }
    .small { font-size: 13px; color: #667085; line-height: 1.55; }
    .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    button { padding: 10px 14px; border: 1px solid #1f6feb; border-radius: 6px; background: #1f6feb; color: white; font: inherit; cursor: pointer; }
    button.secondary { background: white; color: #1f6feb; }
    button:disabled { opacity: .55; cursor: not-allowed; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; background: #111827; color: #e5e7eb; border-radius: 8px; padding: 14px; max-height: 360px; overflow: auto; }
    .bad { color: #b42318; }
    @media (max-width: 760px) { .grid { grid-template-columns: 1fr; } main { padding-top: 20px; } }
  </style>
</head>
<body>
  <main>
    <h1>CCGFW 自动任务</h1>

    <section class="grid">
      <div class="card">
        <div class="label">剩余流量</div>
        <div id="unused" class="value">--</div>
      </div>
      <div class="card">
        <div class="label">总流量</div>
        <div id="traffic" class="value">--</div>
      </div>
      <div class="card">
        <div class="label">今日已用</div>
        <div id="todayUsed" class="value">--</div>
      </div>
      <div class="card">
        <div class="label">已用流量</div>
        <div id="lastUsed" class="value">--</div>
      </div>
    </section>

    <section class="panel" style="margin-top:14px;">
      <h2>运行状态</h2>
      <div id="summary" class="small">等待加载...</div>
      <div class="row" style="margin-top:14px;">
        <button data-action="run">先购买再签到</button>
        <button data-action="buy" class="secondary">只购买</button>
        <button data-action="checkin" class="secondary">只签到</button>
        <button id="refresh" class="secondary">刷新</button>
      </div>
    </section>

    <section class="panel">
      <h2>原始状态</h2>
      <pre id="raw">{}</pre>
    </section>
  </main>

  <script>
    const $ = (id) => document.getElementById(id)

    $("refresh").onclick = () => loadStatus()
    document.querySelectorAll("button[data-action]").forEach((button) => {
      button.onclick = () => runTask(button.dataset.action)
    })

    async function api(path, options = {}) {
      const res = await fetch(path, options)
      const text = await res.text()
      let data
      try { data = JSON.parse(text) } catch { data = { ok: false, message: text } }
      if (!res.ok) throw data
      return data
    }

    async function loadStatus() {
      try {
        const data = await api("/api/status")
        render(data)
      } catch (err) {
        $("summary").innerHTML = '<span class="bad">加载失败：</span>' + escapeHtml(err.message || JSON.stringify(err))
      }
    }

    async function runTask(action) {
      setButtons(true)
      $("summary").textContent = "执行中..."
      try {
        const data = await api("/api/" + action, { method: "POST" })
        $("raw").textContent = JSON.stringify(data, null, 2)
        await loadStatus()
      } catch (err) {
        $("raw").textContent = JSON.stringify(err, null, 2)
        $("summary").innerHTML = '<span class="bad">执行失败：</span>' + escapeHtml(err.message || JSON.stringify(err))
      } finally {
        setButtons(false)
      }
    }

    function render(data) {
      const status = data.status || {}
      const snap = status.trafficSnapshot || {}
      const info = snap.trafficInfo || {}
      $("unused").textContent = info.unUsedTraffic || "--"
      $("traffic").textContent = snap.traffic || "--"
      $("todayUsed").textContent = info.todayUsedTraffic || "--"
      $("lastUsed").textContent = info.lastUsedTraffic || "--"

      const lastBuy = status.lastBuy?.message || "暂无"
      const lastCheckin = status.lastCheckin?.message || "暂无"
      $("summary").innerHTML =
        '<div>定时：' + escapeHtml(data.schedule || "--") + '</div>' +
        '<div>上次运行：' + escapeHtml(formatTime(status.lastRunAt)) + '</div>' +
        '<div>上次购买：' + escapeHtml(lastBuy) + '</div>' +
        '<div>上次签到：' + escapeHtml(lastCheckin) + '</div>' +
        '<div>流量更新时间：' + escapeHtml(formatTime(snap.updatedAt)) + '</div>'
      $("raw").textContent = JSON.stringify(data, null, 2)
    }

    function setButtons(disabled) {
      document.querySelectorAll("button[data-action]").forEach((button) => button.disabled = disabled)
    }

    function formatTime(value) {
      if (!value) return "暂无"
      return new Date(value).toLocaleString("zh-CN", { hour12: false })
    }

    function escapeHtml(value) {
      return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]))
    }

    loadStatus()
  </script>
</body>
</html>`
}
