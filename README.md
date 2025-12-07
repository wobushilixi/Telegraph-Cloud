# ☁️ Telegraph Cloud - 极简/防刷/高性能图床

一个基于 Cloudflare Workers、Pages 和 Telegram 的高性能无服务器图床。

本项目基于 [0-RTT/telegraph](https://github.com/0-RTT/telegraph) 进行深度修改和优化。

## ✨ 特色功能

* **🍎 Apple 极简 UI**：全新设计的磨砂玻璃质感界面，支持拖拽上传。
* **🛡️ 强力防刷**：针对 Cloudflare Free 计划优化的逻辑，配合缓存规则，极大降低 Worker 触发率。
* **⚡ 极速 WebP**：前端自动进行 WebP 压缩，节省带宽和存储空间。
* **📦 多文件上传**：支持批量上传，带独立的进度条显示。
* **📉 资源节省**：移除不必要的内部缓存和统计写入，专注于文件托管核心功能。

## 🛠️ 部署教程

只需拥有一个 Cloudflare 账号和一个 Telegram 账号即可完全免费部署。

### 第一步：准备 Telegram Bot

1.  在 Telegram 中搜索 `@BotFather`。
2.  发送 `/newbot`，按照提示设置 Bot 的名称和用户名。
3.  **保存好 HTTP API Token** (例如 `123456:ABC-DEF...`)。
4.  创建一个新的**频道 (Channel)** 或 **群组 (Group)**。
5.  将刚才创建的 Bot 拉入该频道/群组，并设为**管理员** (拥有发消息权限)。
6.  获取 Chat ID：
    * 在频道中随意发送一条消息。
    * 访问 `https://api.telegram.org/bot<你的Token>/getUpdates`。
    * 在返回的 JSON 中找到 `"chat": { "id": -100xxxxxxx }`，这个 `-100...` 就是你的 `TG_CHAT_ID`。

### 第二步：配置 Cloudflare D1 数据库

1.  登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)。
2.  在左侧菜单选择 **Workers & Pages** -> **D1 SQL Database**。
3.  点击 **Create**，命名为 `telegraph_db` (或任意名称)，点击 **Create**。
4.  点击进入刚才创建的数据库，选择 **Console** 标签页。
5.  **复制并执行**以下 SQL 语句来初始化表结构：
    ```sql
    DROP TABLE IF EXISTS media;
    CREATE TABLE IF NOT EXISTS media (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT UNIQUE,
        fileId TEXT,
        size INTEGER,
        views INTEGER DEFAULT 0,
        timestamp INTEGER
    );
    -- 创建索引优化查询速度
    CREATE UNIQUE INDEX IF NOT EXISTS idx_media_url ON media (url);
    ```

### 第三步：部署 Worker 代码

1.  在 Cloudflare 左侧菜单选择 **Workers & Pages** -> **Overview**。
2.  点击 **Create Application** -> **Create Worker**。
3.  命名你的 Worker (例如 `my-image-host`)，点击 **Deploy**。
4.  点击 **Edit code**。
5.  **将本项目中的 `_worker.js` 内容完全覆盖粘贴进去。** (代码见上文或仓库文件)
6.  点击右上角的 **Save and Deploy**。

### 第四步：绑定变量与数据库 (关键)

1.  回到 Worker 的 **Settings** -> **Variables** 页面。
2.  **Environment Variables (环境变量)**：点击 Add variable，添加以下变量：
    * `DOMAIN`: 你的 Worker 域名 (例如 `my-image-host.user.workers.dev` 或你绑定的自定义域名)
    * `TG_BOT_TOKEN`: 第一步获取的 Bot Token
    * `TG_CHAT_ID`: 第一步获取的 Chat ID
    * `USERNAME`: 后台管理员用户名
    * `PASSWORD`: 后台管理员密码
    * `ADMIN_PATH`: 后台路径 (例如 `admin`)
    * `ENABLE_AUTH`: `true` (建议开启)
    * `MAX_SIZE_MB`: `20` (最大上传大小)
3.  **D1 Database Bindings**：
    * 向下滚动找到 D1 Database Bindings。
    * Variable name 填写 `DATABASE` (必须大写)。
    * D1 Database 选择第二步创建的 `telegraph_db`。
4.  点击 **Deploy** 保存所有设置。

### 第五步：防刷与缓存设置 (必做！！)

为了防止 Worker 额度被刷爆，必须设置 Page Rules 让 CDN 直接接管图片请求。

1.  在 Cloudflare 首页点击你的域名 (如果没有域名，强烈建议绑定一个，否则无法使用 Page Rules)。
2.  进入 **Rules** -> **Page Rules**。
3.  点击 **Create Page Rule**。
4.  **URL (required)**：填写 `img.yourdomain.com/*` (换成你的图床域名)。
5.  添加以下设置：
    * **Cache Level**: Cache Everything (缓存所有内容)
    * **Edge Cache TTL**: a month (一个月)
6.  点击 **Save and Deploy**。

**原理**：配置后，用户访问图片时，Cloudflare 边缘节点会直接返回缓存的图片，**不会触发 Worker 脚本**，从而不消耗你的免费额度。

---

## ⚠️ 关于免费计划

Cloudflare Workers Free 计划每天限制 100,000 次请求。通过上述的 **Page Rules** 设置，只有上传图片和访问后台时会消耗额度，图片的浏览流量将由 Cloudflare CDN 免费承担，理论上可以支持巨大的访问量。

## 🔗 相关链接

* 原作者项目: [0-RTT/telegraph](https://github.com/0-RTT/telegraph)
* 维护者: [wobushilixi](https://github.com/wobushilixi)
