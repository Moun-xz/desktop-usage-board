# 把「今日待办」和微软待办（Microsoft To Do）双向同步

看板里的待办默认只存在本地。想让它和手机 / 网页上的 **微软待办** 同步，需要一个属于你自己的 **Azure 应用 Client ID**。

> 为什么不能内置一个公共 Client ID？
> 因为微软的授权是「应用 + 你本人」两层：应用必须由使用者自己注册，令牌也只发给你自己的账号。
> 注册是免费的，全程大约 5 分钟，**不需要 Azure 订阅、不需要信用卡**。

---

## 零、先确认你有一个「Azure 租户」（90% 的人会卡在这一步）

如果你用 **QQ 邮箱 / outlook.com / hotmail 这类个人微软账号** 打开 <https://portal.azure.com>，
很可能会看到这条报错：

> 所选的用户帐户在租户「Microsoft Services」中不存在，且无法访问该租户中的应用程序
> `c44b4083-3bb0-49c1-b47d-974e53cbdf3c`。

**这不是看板的问题，也不是你账号坏了。** 个人微软账号默认只挂在「Microsoft Services」这个消费者租户里，
而那个租户不允许注册应用 —— 你必须先有自己的 Azure 账户（它会顺带建一个属于你的租户）。

### 推荐路径：Azure for Students（免费，不要信用卡）

1. 打开 <https://azure.microsoft.com/free/students> → **立即激活 / Activate now**。
2. 用你**那个个人微软账号**登录（不是学校邮箱）。
3. 认证学生身份（三选一，按页面提示走）：
   - **学校邮箱**（`@xxx.edu.cn`）能自动验证最好；
   - 学校邮箱不被识别时，可以**上传在读证明 / 学生证 + 注册证明**（要求：姓名、学校名、当前在读状态），
     由 SheerID 审核，通常几分钟、最慢 48 小时；
   - 或者用 **GitHub Student Developer Pack** 通道（先在 <https://education.github.com/pack> 认证学生身份，
     再回到 <https://signup.azure.com/studentverification> 用 GitHub 授权验证）。
4. 验证通过后，`portal.azure.com` 里就会出现你的订阅和**默认目录（租户）**，右上角能看到租户名，
   **Entra ID → 概述 → 属性 → 租户 ID** 可以查到租户 ID。

> 这条路径顺便会给你 $100 额度（12 个月），做别的 Azure 实验也能用。

### 备选路径：Azure 免费账户（需要一张银行卡做身份验证）

到 <https://azure.microsoft.com/free> 走「免费开始使用」，注册过程会创建租户。
需要银行卡做身份校验（**免费额度内不会扣费**，但要留意到期后是否转成按量付费）。

> ⚠️ 一个微软账号只能是**一个** Azure for Students 的成员；验证失败时不要反复重试，
> 容易把这个账号的额度机会用掉 —— 先看清报错再操作。

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
  "tenant": "common",
  "listId": "",
  "listName": "",
  "syncMinutes": 5
}
```

- `tenant` 默认 `common`：组织账号和个人微软账号都能登录（应用注册在你自己的租户里也能用个人账号登录）。
- 如果只想允许个人账号，用 `consumers`；只允许公司/学校账号，用 `organizations`。
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
| **打开 Azure 门户就报「所选用户帐户在租户 Microsoft Services 中不存在…`c44b4083-…`」** | 个人微软账号还没有自己的租户 → 先按上面 **第零节** 开通 Azure for Students（免费无卡） |
| 菜单里「登录微软账号」点了没反应 | `data/settings.json` 的 `msTodo.clientId` 还没填 |
| 登录页报 `AADSTS7000218` | 「允许公共客户端流」没开 |
| 登录页报 `AADSTS50020` / 提示账号不在该租户 | 应用注册时「受支持的帐户类型」没选含个人账号的选项；或 `tenant` 设成了 `organizations` |
| 登录页报 `AADSTS50059` / 找不到租户 | `msTodo.tenant` 改成 `common` |
| 同步 401 | 令牌过期且刷新失败 → 菜单里重新登录 |
| 同步 403 | API 权限里没加 `Tasks.ReadWrite`，或没同意授权 |
| 同步 404 | 选的清单被删了 → 重新「选择要同步的清单」 |
| 公司/学校账号登录失败 | `tenant` 改成 `common`；有些企业会禁止个人应用访问，只能换个人账号 |
| 不想同步了 | 菜单 → 断开连接；或把 `msTodo.enabled` 设为 `false` |
