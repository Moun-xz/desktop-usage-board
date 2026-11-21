# 把「今日待办」和微软待办（Microsoft To Do）双向同步

看板里的待办默认只存在本地。想让它和手机 / 网页上的 **微软待办** 同步，需要一个属于你自己的 **Azure 应用 Client ID**。

> 为什么不能内置一个公共 Client ID？
> 因为微软的授权是「应用 + 你本人」两层：应用必须由使用者自己注册，令牌也只发给你自己的账号。
> 注册是免费的，全程大约 5 分钟，**不需要 Azure 订阅、不需要信用卡**。

---

## 一、注册 Azure 应用（只做一次）

1. 打开 <https://portal.azure.com>，用你的微软账号登录（outlook / hotmail / live 都行）。
2. 搜索 **「应用注册」/ App registrations** → 点 **新注册**。
3. 名称随便写，例如 `桌面看板`。
4. **受支持的帐户类型**选：
   **「任何组织目录中的帐户和个人 Microsoft 帐户」**（`Accounts in any organizational directory and personal Microsoft accounts`）。
5. 重定向 URI **留空**（设备码登录不需要）。
6. 点「注册」。
7. 在应用页面上方复制 **「应用程序(客户端) ID」**（一串形如 `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` 的 GUID）。

## 二、允许「设备码登录」

1. 左侧 **身份验证 / Authentication**。
2. 拉到最下面，**允许公共客户端流 / Allow public client flows** 选 **是 / Yes**。
3. 保存。

> 不打开这一项，登录时会报 `AADSTS7000218`。

## 三、加 API 权限

1. 左侧 **API 权限 / API permissions** → **添加权限**。
2. 选 **Microsoft Graph** → **委托的权限 / Delegated permissions**。
3. 搜索并勾选：
   - `Tasks.ReadWrite` — 读写你的待办（**只需要这一项**，看板拿不到你的邮件、文件、日历）
   - `offline_access` — 让你重启之后不用重新登录
4. 点「添加权限」。
5. 个人账号不需要「授予管理员同意」；第一次登录时页面会让你本人同意一次即可。

## 四、把 Client ID 填进看板

打开 `data/settings.json`（没有就先启动一次看板），把 `msTodo` 填成这样：

```json
"msTodo": {
  "enabled": true,
  "clientId": "粘贴-你的-客户端-ID",
  "tenant": "consumers",
  "listId": "",
  "listName": "",
  "syncMinutes": 5
}
```

- 个人微软账号：`tenant` 用 `consumers`
- 公司 / 学校账号：`tenant` 用 `common`
- `listId` / `listName` 先留空，登录后再从菜单里选。

## 五、登录并选清单

1. 重启看板（`start.vbs`）。
2. 右键托盘图标（或点卡片右上角 `⋯`）→ **微软待办同步** → **登录微软账号**。
3. 看板会复制一个**设备码**到剪贴板，并自动打开 <https://microsoft.com/devicelogin>；
   在页面里粘贴代码 → 用你的微软账号登录 → 同意授权。
4. 回到看板点「我已完成」。
5. 弹出清单列表 → **选一个要同步的清单**（一般是「任务」）。

之后：

- 每 **5 分钟**自动同步一次（`syncMinutes` 可改）；
- 在看板上添加 / 勾选 / 删除待办，2 秒内推给微软待办；
- 在手机或网页上改，看板下次同步时拉回来；
- 待办面板标题栏右侧会显示 `☁ 已同步` / `☁ 同步中` / `⚠ 未同步`（悬停看详情）。

---

## 同步规则（重要，避免误删）

| 情况 | 结果 |
| --- | --- |
| 微软待办里新加了一条 | 拉进看板，算作「今天」的 |
| 看板上新加一条 | 推到微软待办（**只推今天的**，历史任务不会回灌） |
| 两边都改了同一条 | 谁后改的听谁的（按 Graph 的 `lastModifiedDateTime` 比较） |
| 在微软待办里删了 | 看板下次同步时也删掉 |
| 在看板上删了 | 立刻把微软待办里那条也删掉 |
| 勾选了 | 两边同步勾选状态（微软待办里显示为「已完成」） |

看板每次只同步「当前清单」的前 200 条任务。

---

## 安全与隐私

- 令牌保存在 `data/ms-token.json`（权限 600，已加入 `.gitignore`，不会被提交）。
- 权限只有 `Tasks.ReadWrite`，看板**读不到**邮件、文件、通讯录。
- 想断开：菜单 → 微软待办同步 → **断开连接**（会删掉本地令牌；看板里的待办仍然保留）。
  也可以去 <https://account.microsoft.com/privacy/app-access> 撤销授权。

## 常见问题

| 现象 | 原因 / 解决 |
| --- | --- |
| 菜单里「登录微软账号」点了没反应 | `data/settings.json` 的 `msTodo.clientId` 还没填 |
| 登录页报 `AADSTS7000218` | 「允许公共客户端流」没开 |
| 同步 401 | 令牌过期且刷新失败 → 菜单里重新登录 |
| 同步 403 | API 权限里没加 `Tasks.ReadWrite`，或没同意授权 |
| 同步 404 | 选的清单被删了 → 重新「选择要同步的清单」 |
| 公司/学校账号登录失败 | `tenant` 改成 `common`；有些企业会禁止个人应用访问，只能换个人账号 |
| 不想同步了 | 菜单 → 断开连接；或把 `msTodo.enabled` 设为 `false` |
