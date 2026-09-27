# 麻酱的游戏厅

这是一个开源的网页联机练习项目，用能玩的小游戏验证浏览器交互、跨设备房间状态同步和服务端规则。网页用 JavaScript 显示手牌并提交选择；Cloudflare Pages Function 把请求转给对应房间的 Durable Object，由它保存牌局和判定结果。双方选好前，接口不会把对方手牌发给浏览器。当前采用定时请求同步状态，不是浏览器之间的 P2P 直连。

第一个可玩的原型是双人扑克牌比大小：每人先拿五张牌，每回合各选一张，双方选好后一起翻开。A 最小，K 最大；同点数不计胜。五回合后胜场较多者获胜，打平则再发五张加赛。牌堆不足十张时换一副新牌。

## 运行方式

- `public/` 是游戏厅和游戏页面；`functions/` 是 Cloudflare Pages API；`room-worker/` 是保存每桌状态的 Durable Object Worker。
- 页面部署在 Cloudflare Pages，房间状态由 Durable Object 保存。GitHub Pages 上的旧地址会跳转到 Cloudflare Pages。
- 关闭页面后不会立刻删除房间；长期没有游戏操作的房间会在约 24 小时后自动清空存储。新开一桌即可再玩。
- 当前 Cloudflare Pages 项目采用 Wrangler Direct Upload。推送 GitHub **不会自动发布**；更新上线需要分别部署 Worker（如果改了 `room-worker/`）和 Pages。不要把 Wrangler 的登录信息提交到仓库。

```powershell
npm ci
npm test
npx wrangler deploy --config room-worker/wrangler.toml
npx wrangler pages deploy public --project-name majiang-gamelobby --branch main
```

联机流程验证（会创建一个新房间）：

```powershell
$env:TEST_BASE_URL='https://majiang-gamelobby.pages.dev'
npm run test:flow
```
