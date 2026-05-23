# CCGFW Cloudflare Worker 自动购买和签到

这个 Worker 会定时先购买套餐，再每日签到，并把运行结果写入 Workers KV。状态页无需鉴权，打开即可查看和手动触发。

## 功能

- 北京时间每天 00:00 和 12:00 自动执行
- 执行顺序：先购买，再签到
- 状态页展示上次运行、上次购买、上次签到
- 展示上一次签到成功时保存的剩余流量、总流量、今日已用和已用流量
- 页面按钮可手动执行完整流程、只购买、只签到
- 部署脚本自动创建/复用 KV namespace：`ccgfw-auto-buy-status`
- 不使用 Wrangler，直接通过 Cloudflare REST API 部署

## 项目结构

```txt
src/index.mjs          Worker 入口和路由
src/tasks/buy.mjs      购买任务
src/tasks/checkin.mjs  签到任务
src/storage.mjs        KV 状态读写
src/routes/page.mjs    状态页 HTML
dist/worker.mjs        esbuild 打包产物
scripts/deploy-api.sh  API 部署脚本
```

## 部署

本地部署时，`.env` 至少需要：

```bash
CLOUDFLARE_API_TOKEN='...'
CCGFW_COOKIE='sid=...; cf_clearance=...'
```

执行：

```bash
cd /Users/ray/Documents/Fork/LITTLEPRO/CCGFW自动购买油猴脚本/ccgfw-worker
./scripts/deploy-api.sh
```

脚本会自动：

- 安装 npm 依赖
- 用 esbuild 打包 `src/index.mjs` 到 `dist/worker.mjs`
- 创建/复用 KV namespace
- 上传 Worker
- 上传 `CCGFW_COOKIE`
- 绑定 KV：`STATUS_KV`
- 设置 cron：`0 4,16 * * *`

## GitHub Actions 自动部署

仓库已包含 workflow：

```txt
.github/workflows/deploy-ccgfw-worker.yml
```

每次 push 到 `main`，只要改动了 `ccgfw-worker/**` 或 workflow 文件，就会自动编译并部署到 Cloudflare。

你需要在 GitHub 仓库里配置两个 Secrets：

```txt
CLOUDFLARE_API_TOKEN
CCGFW_COOKIE
```

设置位置：

```txt
GitHub 仓库 -> Settings -> Secrets and variables -> Actions -> New repository secret
```

`CLOUDFLARE_API_TOKEN` 至少需要 Workers 编辑权限和 Workers KV Storage 编辑权限。`CCGFW_COOKIE` 填浏览器里复制出来的完整 Cookie。

也可以在 GitHub Actions 页面手动点 `Deploy CCGFW Worker` 这个 workflow 的 `Run workflow`。

## 地址

状态页：

```txt
https://ccg.raymondreal.dpdns.org/
```

Workers.dev 地址：

```txt
https://ccgfw-auto-buy.cyb2831173936.workers.dev/
```

健康检查：

```bash
curl 'https://ccgfw-auto-buy.cyb2831173936.workers.dev/health'
```

手动运行：

```bash
curl -X POST 'https://ccgfw-auto-buy.cyb2831173936.workers.dev/run'
curl -X POST 'https://ccgfw-auto-buy.cyb2831173936.workers.dev/buy'
curl -X POST 'https://ccgfw-auto-buy.cyb2831173936.workers.dev/checkin'
```

## 定时

Cloudflare cron 使用 UTC。当前配置：

```txt
0 4,16 * * *
```

对应北京时间：

```txt
每天 12:00
每天 00:00
```

## Cloudflare 后台检查

打开：

```txt
https://dash.cloudflare.com/?to=/:account/workers/services/view/ccgfw-auto-buy/production
```

重点看：

- Worker 名称：`ccgfw-auto-buy`
- Triggers：`0 4,16 * * *`
- Variables and Secrets：`CCGFW_COOKIE`
- Bindings：`STATUS_KV`
- Logs / Observability：运行日志

## 常见问题

### Cloudflare API HTTP 403

API Token 权限不够。现在脚本会创建 KV，所以 token 至少需要 Workers 编辑权限和 Workers KV Storage 编辑权限。

### Worker 返回登录失效、403、HTML 页面或 Cloudflare challenge

通常是 `CCGFW_COOKIE` 失效，尤其是 `cf_clearance`。重新从浏览器复制完整 Cookie，更新 `.env` 后重新执行：

```bash
./scripts/deploy-api.sh
```

### 没有流量数据

页面只展示“上一次签到成功时保存的流量”。如果最近一次签到返回的是“已签到”，接口不会返回 `trafficInfo`，页面就会继续保留旧值或显示空。

### 自定义域名是否影响部署

不影响。`ccg.raymondreal.dpdns.org` 是 Cloudflare Worker 的域/路由绑定，不参与 esbuild 构建，也不影响 `scripts/deploy-api.sh` 上传代码。只有想让脚本自动创建自定义域名绑定时才需要改部署脚本。

## 安全提示

你要求不鉴权，所以状态页和手动运行接口都是公开的。`.env` 仍然不会被正常提交，但 `CLOUDFLARE_API_TOKEN` 和 `CCGFW_COOKIE` 泄露后建议及时刷新。
