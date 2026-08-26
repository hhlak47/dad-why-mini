# 《爸爸，我为什么？》微信小程序 · MVP v0.1

> 把孩子的每一个“为什么”，变成一次有趣的探索。
> 不是让 AI 陪孩子，而是让 AI 帮爸爸妈妈更好地陪孩子。

这是按 PRD 实现的**微信原生小程序**源码，可在微信开发者工具中运行并真机预览。
核心闭环：**首页提问 → AI「讲给孩子听」→ 再简单一点 / 她还在追问 / 和孩子一起做游戏**。

---

## 零、最快路径：Mock 模式（零配置，先看效果）✨

> **你现在啥都没有？这是给你的最省事路线。** 不需要 AppID、不需要云环境、不需要任何 API Key，
> 先把完整的界面和「提问 → 讲给孩子听 → 再简单一点 / 她还在追问 / 做游戏」闭环在手机上跑起来看效果。
> 之后想接真实 AI，再按「方式一 / 方式二」切换即可。

### 1. 安装微信开发者工具
下载地址：<https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html>
按你电脑系统（macOS / Windows）下载「稳定版 Stable Build」，双击安装。

### 2. 导入项目
- 打开微信开发者工具 → 点「导入项目 / +」。
- 目录选：`dad-why-mini`（本文件夹）。
- **AppID** 那里点「测试号」（开发者工具会自动给你一个测试用的 AppID，不用注册）。
- 点「导入」。

### 3. 直接运行（已是 Mock 模式）
项目里 `config.js` 已经设好 `BACKEND_MODE: 'mock'`，导入后**直接点「编译」**，
左边模拟器就会显示首页。输入一句话（比如「为什么月亮一直跟着我？」），选年龄，点「讲给孩子听」，
就能看到示例回答和三个互动按钮——全程无需任何账号或 Key。

### 4. 在手机上真机预览
- 开发者工具里点「预览」（或「真机调试」）。
- 用你自己的微信扫码。
- 手机上即可体验完整流程。（测试号也能预览；若要长期/发布再用自己的 AppID。）

> 看到回答里带「（示例·未接真实 AI）」字样，说明现在是 Mock 假数据。
> 想换成真实的适龄回答 → 见下方「方式一（云函数）」或「方式二（本地服务器）」。

---

## 一、目录结构

```
dad-why-mini/
├── app.js / app.json / app.wxss      # 小程序入口与全局配置
├── config.js                         # 后端模式与地址配置（前端不含任何 Key）
├── project.config.json               # 开发者工具项目配置
├── sitemap.json
├── pages/
│   ├── index/                        # 页面一：首页（提问 + 年龄选择）
│   └── chat/                         # 页面二：回答页（回答 + 三个互动按钮）
├── utils/
│   ├── ai.js                         # AI 请求层（云函数 / HTTP 两种模式）
│   └── storage.js                    # 本地保存孩子年龄
├── cloudfunctions/
│   └── ask/                          # 云函数：调用大模型，内置 System Prompt
│       ├── index.js
│       └── package.json
├── server/
│   └── index.js                      # 备选：本地/自建 HTTP 服务（无需云环境）
├── SYSTEM_PROMPT.md                  # 当前使用的 System Prompt（与代码保持一致）
├── TEST_CASES.md                     # 6 个验收案例
└── future.md                         # 暂未实现、留待后续的功能
```

---

## 二、前置准备

> **只想先看效果（Mock 模式）**：只需第 1 步「安装微信开发者工具」即可，AppID 用「测试号」，无需任何 Key。
> 想接真实 AI，再补第 2、3 步并参考「方式一 / 方式二」。

1. 安装 [微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)。
2. 注册一个微信小程序账号，拿到 **AppID**（在「微信公众平台 → 开发 → 开发管理 → 开发设置」查看）。
3. 准备一个 **DeepSeek API Key**（默认模型 `deepseek-chat`）。
   也支持任何 OpenAI 兼容接口（腾讯混元、OpenAI 等），见下文「切换模型」。

> 本项目默认使用「微信云开发云函数」作为后端（PRD 推荐，API Key 最安全）。
> 如果你**没有云环境**，可直接用 `server/` 本地服务做真机预览，见「方式二」。

---

## 三、方式一：云函数（推荐）

### 1. 导入项目
- 微信开发者工具 → 导入项目 → 选择本目录 `dad-why-mini`。
- **AppID** 填你自己的（不要用测试号，云开发需要真实 AppID）。
- 把 `project.config.json` 里的 `"appid": "wxYOUR_APPID"` 改成你的 AppID。

### 2. 开通云开发
- 开发者工具顶部点「云开发」→ 开通 → 创建环境，记下**环境 ID**。

### 3. 部署 ask 云函数
- 在「云开发 → 云函数」里，右键 `cloudfunctions/ask` → 上传并部署（云端安装依赖）。
- 或在文件树右键 `cloudfunctions/ask` → 「新建并部署：云端安装依赖」。

### 4. 配置环境变量（关键！）
在「云开发 → 云函数 → ask → 配置 → 环境变量」中添加：

| 键 | 值 | 说明 |
|----|----|------|
| `API_KEY` | `sk-xxxx` | 你的 DeepSeek（或兼容厂商）API Key **必填** |
| `API_BASE` | `https://api.deepseek.com/v1` | 选填，默认即此 |
| `MODEL` | `deepseek-chat` | 选填，默认即此 |

> ⚠️ API Key 只存在于云端环境变量，前端代码里**绝不出现** Key。

### 5. 修改 config.js
```js
module.exports = {
  BACKEND_MODE: 'cloud',
  CLOUD_ENV: '你的云环境ID',   // ← 改成第 2 步记下的环境 ID
  CLOUD_FUNCTION: 'ask',
  HTTP_BASE_URL: 'http://192.168.1.100:3000' // 云模式用不到，留着即可
}
```

### 6. 编译运行
- 回到开发者工具，点「编译」。首页出现后输入问题、选年龄、点「讲给孩子听」。

---

## 四、方式二：本地服务器（无云环境也能真机预览）

适合没有云开发环境、想快速在手机上试用的场景。手机和电脑需连**同一 WiFi**。

### 1. 启动服务
```bash
cd dad-why-mini/server
export API_KEY=sk-你的DeepSeekKey
# 可选：
# export API_BASE=https://api.deepseek.com/v1
# export MODEL=deepseek-chat
node index.js
# 看到 “本地服务已启动: http://localhost:3000/ask” 即成功
```

### 2. 修改 config.js
```js
module.exports = {
  BACKEND_MODE: 'http',
  HTTP_BASE_URL: 'http://电脑局域网IP:3000'  // 例：http://192.168.1.100:3000
}
```
> 电脑的局域网 IP 可在终端用 `ifconfig` / `ipconfig` 查看（不要写 localhost，手机访问不到）。

### 3. 关闭域名校验
微信开发者工具 → 详情 → 本地设置 → 勾选「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」。
（仅本地调试用；正式发布需在小程序后台配置 request 合法域名。）

### 4. 编译运行
同方式一第 6 步。

---

## 五、真机预览（在手机上运行）

1. 开发者工具里点「预览」（或「真机调试」）。
2. 用**注册了该小程序的微信账号**扫码。
3. 手机上即可输入孩子的真实问题，选年龄，点「讲给孩子听」。
4. 全流程：讲给孩子听 → 再简单一点 / 她还在追问 / 和孩子一起做游戏 → 问一个新的为什么。

> 注意：预览二维码有时效，过期后重新点「预览」即可。
> 若用方式二（本地服务器），手机必须与电脑同一 WiFi，且 `HTTP_BASE_URL` 填电脑局域网 IP。

---

## 六、切换模型（DeepSeek / 混元 / OpenAI）

代码使用 **OpenAI 兼容接口**，换模型只需改环境变量：

| 厂商 | API_BASE | MODEL |
|------|----------|-------|
| DeepSeek（默认） | `https://api.deepseek.com/v1` | `deepseek-chat` |
| 腾讯混元 | `https://api.hunyuan.cloud.tencent.com/v1` | `hunyuan-lite` 或 `hunyuan-pro` |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` |

- 云函数：在云函数环境变量里改 `API_BASE` / `MODEL`。
- 本地服务：用 `export API_BASE=...` / `export MODEL=...` 重启。

---

## 六·二、语音功能（语音输入 / 语音播放）

小程序支持两个语音能力：

- **语音输入**：首页「🎤 按住说话」——按住录入孩子的原话，松手自动识别成文字填入提问框（amr 格式，腾讯云一句话识别）。
- **语音播放**：回答卡片「🔊 念给孩子听」——把 AI 的回答合成温柔女声（mp3），直接放给孩子听。

### 1. 准备腾讯云密钥
语音识别（ASR）与语音合成（TTS）共用**腾讯云**一组密钥（比接两个厂商省事，且中国大陆可用）：
1. 注册/登录腾讯云 → <https://console.cloud.tencent.com/cam/capi> 获取 **SecretId** 和 **SecretKey**。
2. 开通「语音识别 ASR」和「语音合成 TTS」两个服务（控制台搜索即可，有免费额度）。
3. 把子账号/主账号的 Secret 填到下面环境变量。

> 密钥只出现在你的电脑环境变量里，前端代码**绝不携带**。

### 2. 安装语音 SDK（首次）
```bash
cd dad-why-mini/server
npm install        # 安装 tencentcloud-sdk-nodejs
```

### 3. 启动服务（带语音密钥）
```bash
cd dad-why-mini/server
export API_KEY=sk-你的DeepSeekKey
export TENCENT_SECRET_ID=你的SecretId
export TENCENT_SECRET_KEY=你的SecretKey
node index.js
# 启动日志若没有「未检测到 TENCENT_SECRET…」提示，即语音已就绪
```

### 4. 前端无需额外配置
`config.js` 里 `VOICE_BASE_URL` 默认等于 `HTTP_BASE_URL`，填的是你电脑局域网 IP，手机同 WiFi 即可访问 `/asr` 和 `/tts`。

### 5. 没有密钥会怎样？
- 文字问答完全正常。
- 点「按住说话」/「念给孩子听」会提示「语音功能未配置」，不会出现白屏或崩溃。

> ⚠️ 真机预览时手机必须与电脑同一 WiFi；语音接口走的是你的局域网服务器，不经过微信服务器，**无需在小程序后台配置 request 合法域名**（但开发者工具里仍需勾选「不校验合法域名」，见方式二第 3 步）。

---

## 七、功能对照（PRD P0）

| 功能 | 状态 |
|------|------|
| 输入孩子的问题 | ✅ |
| 选择孩子年龄（3/4/5/6，记住上次） | ✅ |
| AI 生成「讲给孩子听」 | ✅ |
| 「再简单一点」 | ✅ |
| 「她还在追问」 | ✅（保留上下文，最多连续 5 轮） |
| 「和孩子一起做游戏」 | ✅（当前页插入游戏卡片） |
| 保持当前问答上下文 | ✅ |
| 重新开始一个新问题 | ✅ |
| Loading 轮换文案 / 失败重试 / 空输入校验 / JSON 容错 | ✅ |
| 一键复制回答（P1） | ✅ |
| 语音输入「按住说话」识别成文字（P1/阶段三） | ✅（需腾讯云 ASR 密钥） |
| 语音播放「念给孩子听」（P1/阶段三） | ✅（需腾讯云 TTS 密钥） |
| 本地保存最近 10 个问题（P1） | ⏸ 未实现，见 future.md |

---

## 八、常见问题

**Q：编译报错 “wx.cloud is not a function”？**
A：确认 `config.js` 的 `BACKEND_MODE` 与实际后端一致；用云端模式时需真实 AppID 且已开通云开发。

**Q：点「讲给孩子听」一直转圈或报错？**
A：检查云函数环境变量 `API_KEY` 是否配置、环境 ID 是否正确；或本地服务是否已启动、手机与电脑是否同 WiFi、域名校验是否已关闭。

**Q：返回内容是乱码 / 解析失败？**
A：代码已对 JSON 做容错（含去除 ```json 代码块、失败回退为纯文本），不会白屏。

**Q：正式发布到线上需要什么？**
A：在小程序后台配置 request 合法域名（云函数无需；若用自建服务需配 HTTPS 域名），并在云函数环境变量填好 Key。
