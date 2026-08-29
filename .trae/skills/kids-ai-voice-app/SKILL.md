---
name: "kids-ai-voice-app"
description: "Build a WeChat Mini Program where parents ask AI parenting questions and play AI answers cloned in the parent's own voice (Tencent Cloud ASR/TTS/VoiceClone + DeepSeek). Invoke when the user wants to create a kids' Q&A/parenting mini program, build an AI voice-cloning app, or make any WeChat mini program that combines LLM answers with parent voice cloning for children."
---

# Kids AI Voice App — 亲子 AI 语音问答小程序构建指南

把"孩子提问 → AI 生成适合年龄的回答 → 用**爸爸妈妈自己的声音**念给孩子听"做成微信小程序的完整工程方案。核心理念：**不是让 AI 陪孩子，而是让 AI 帮父母陪孩子**。

## 适用场景

当用户有以下需求时使用本 Skill：
- 制作面向 3-6 岁孩子父母的 AI 问答/科普/育儿小程序
- 希望 AI 回答能用**父母本人的声音**播放（声音克隆）
- 需要微信小程序前端 + 微信云开发后端 + 大模型 API + 腾讯云语音
- 任何"LLM 回答 + 语音合成 + 声音克隆"组合的小程序

## 一、整体架构

### 页面流转（4 个页面）

```
pages/index（首页：问题输入 + 年龄选择 + 按住说话语音输入）
   │  navigateTo → /pages/chat/chat?q=...&age=...
   ├─→ pages/chat（聊天页：进页自动请求 AI 回答）
   │      ├─ 动作按钮：再简单一点 / 继续追问(最多5轮,支持语音) / 一起做游戏
   │      ├─ 每条回答：🔊念给孩子听(可选默认/爸爸/妈妈音色)、复制、收藏
   │      ├─ navigateTo → pages/voice（声音克隆）/ pages/favorites（收藏）
   │      └─ "问新问题" → wx.reLaunch 回 /pages/index/index?clear=1（清空输入框）
   ├─→ pages/voice（声音克隆页：爸爸/妈妈 tab + 引导文案 + 录音→克隆→存云数据库）
   └─→ pages/favorites（收藏列表，本地 Storage）
```

### 后端三模式（config.js 中 BACKEND_MODE 切换，前端零密钥）

| 模式 | 走向 | 适用 |
|------|------|------|
| `mock` | 本地假数据（600ms 延迟） | 零配置先看界面（**仅文字问答**，语音不可用会 toast 降级提示） |
| `cloud`（推荐） | `wx.cloud.callFunction` → ask/voice 云函数 | 免服务器、免改 IP |
| `http` | `wx.request` POST 自建 Node 服务器 | 本地调试，手机电脑同 WiFi（接口契约见 [frontend-contracts.md](frontend-contracts.md) 第 7 节） |

**密钥安全原则**：所有 API Key 只存在于云函数环境变量 / 服务器环境变量，前端代码绝不出现密钥。

## 二、云函数设计（微信云开发）

需要两个云函数，均只依赖 `wx-server-sdk`，**不要引入腾讯云 SDK**（见踩坑 #1）。

### 云函数 1：`ask`（AI 问答）

- **环境变量**：`API_KEY`（必填）、`API_BASE`（默认 `https://api.deepseek.com/v1`）、`MODEL`（默认 `deepseek-chat`）。任何 OpenAI 兼容厂商可切换。
- **config.json**：`{"timeout": 20, "memorySize": 256}`（默认 3 秒会超时，见踩坑 #3）
- **实现要点**：
  - 用 Node 原生 `https` 直接 POST `{apiBase}/chat/completions`，`Authorization: Bearer <key>`
  - 请求体：`{model, messages:[system, user], temperature:0.85, response_format:{type:'json_object'}}`
  - System Prompt 内置云函数，角色为"擅长和 3-6 岁孩子交流的亲子好奇心助手"
  - **action 机制**：前端传 `{action, childAge, originalQuestion, messages:[{role,content}], followUpQuestion, lastAnswer}`，云端按 action 拼 user prompt：
    - `answer`：80-180 字，判断年龄理解层 + 生活化类比 + 父母可直接念
    - `simpler`：50-120 字，**换角度而非缩短**
    - `followup`：带完整会话历史 + 最新追问，不重复、可引用旧比喻
    - `game`：生成马上能玩的亲子游戏（找一找/猜一猜/演一演等），无材料、3 分钟可开始
  - **JSON 5 级容错**（模型输出不稳定，必须兜底）：
    1. 直接 `JSON.parse`
    2. 正则去掉 ```` ```json ```` 代码块再 parse
    3. 截取第一个 `{...}` 片段 parse
    4. 截取第一个 `[...]` 片段 parse
    5. 全失败则把原文包成 `{type:'answer', content:原文}`，绝不白屏
  - 返回统一格式：`{ok:true, data:parsed}` / `{ok:false, error:msg}`
- 完整模板见 [templates/cloudfunction-ask.js](templates/cloudfunction-ask.js)

### 云函数 2：`voice`（ASR + TTS + 声音克隆）

- **环境变量**：`TENCENT_SECRET_ID`、`TENCENT_SECRET_KEY`、`TRTC_SDK_APP_ID`（TRTC 应用的 SdkAppId，不是腾讯云 AppID）
- **config.json**：`{"timeout": 60, "memorySize": 256}`（声音克隆耗时长）
- **零依赖**：用原生 `https` + `crypto` 手写腾讯云 **TC3-HMAC-SHA256** 签名（见第三节）
- 三个 action：`asr` / `tts` / `clone`，通过 `event.voiceAction` 区分
- 完整模板见 [templates/cloudfunction-voice.js](templates/cloudfunction-voice.js)

### 数据库集合

- `voices` 集合：`{role:'dad'|'mom', voiceId:'v-xxx', name, createdAt}`，前端用 `wx.cloud.database()` 直接读写

## 三、腾讯云 TC3-HMAC-SHA256 签名（核心，零依赖实现）

通用函数 `tencentRequest(service, action, payload, region, version)`，host=`<service>.tencentcloudapi.com`，POST `/`：

1. **Canonical Request**（换行拼接）：
   - `POST` / `/` / 空 querystring
   - 规范头（每行末尾 `\n`）：`content-type:application/json; charset=utf-8`、`host:<host>`、`x-tc-action:<action 小写>`
   - `signedHeaders = 'content-type;host;x-tc-action'`
   - `hex(sha256(payload JSON 字符串))`
2. **String to Sign**：`TC3-HMAC-SHA256` + Unix 时间戳 + `<UTC日期>/<service>/tc3_request` + `hex(sha256(canonicalRequest))`
3. **密钥派生**（三层 HMAC，digest 用 buffer）：
   - `secretDate = HMAC_SHA256(date, 'TC3' + SECRET_KEY)`
   - `secretService = HMAC_SHA256(service, secretDate)`
   - `secretSigning = HMAC_SHA256('tc3_request', secretService)`
   - `signature = HMAC_SHA256(stringToSign, secretSigning)` 取 hex
4. **Authorization 头**：`TC3-HMAC-SHA256 Credential=<ID>/<date>/<service>/tc3_request, SignedHeaders=content-type;host;x-tc-action, Signature=<hex>`
5. 另需请求头：`X-TC-Action`、`X-TC-Timestamp`、`X-TC-Version`、`X-TC-Region`（默认 `ap-guangzhou`）
6. 响应：`json.Response.Error` 存在则 reject（挂 code/requestId），否则 resolve `Response`

**签名验证技巧**：用假但格式正确的 SecretId（如 `AKIDz8krbsJ5yKBZQpn74WFkmLPx3EXAMPLE`）测试，返回 `AuthFailure.SecretIdNotFound` 说明签名格式正确；若返回签名格式错误则签名逻辑有 bug。

## 四、语音功能完整链路

### 录音（前端 RecorderManager）

```js
rm.start({ format: 'mp3', sampleRate: 16000, numberOfChannels: 1, encodeBitRate: 48000 })
```

- 单例 `wx.getRecorderManager()`，`onStop` 回调中用 `FileSystemManager.readFileSync(res.tempFilePath, 'base64')` 读成 base64
- **必须用 mp3，不能用 wav**（见踩坑 #2）：30 秒 mp3 约 240KB，wav 同长度约 640KB+

### ASR 语音识别

- 服务 `asr`，action `SentenceRecognition`，version `2019-06-14`
- 参数：`SubServiceType:2`、`EngSerViceType:'16k_zh'`、`SourceType:1`、`VoiceFormat:'mp3'`、`Data:<base64>`、`DataLen:<字节数>`、`UsrAudioKey:<任意字符串>`
- 返回 `Response.Result` 为识别文本

### TTS 语音合成（双引擎按音色自动路由）

判断逻辑：`voiceId` 为空或纯数字 → 基础引擎；`v-xxx` 克隆音色 → TRTC 引擎。

**基础 TTS（便宜，0.3 元/万字符）**：
- 服务 `tts`，action `TextToVoice`，version `2019-08-23`
- 参数：`VoiceType` 数字 ID（如 `101001` 智瑜温柔女声）、`Volume:5`、`Speed:0`、`SampleRate:16000`、`Codec:'mp3'`
- **单次限 150 汉字**：超长需按标点（。！？；，、）从切片尾部回退找断点切分，逐段合成后 `Buffer.concat` 拼接 mp3

**TRTC TTS（克隆音色，3 元/万字符）**：
- 服务 `trtc`，action `TextToSpeech`，version `2019-07-22`
- 参数：`Voice:{VoiceId:'v-xxx'}`、`SdkAppId`、`Model:'flow_02_turbo'`、`Language:'zh'`、`AudioFormat:{Format:'mp3', SampleRate:16000, Bitrate:64}`
- 返回 `Response.Audio`（base64 mp3）

### 播放（前端）

```js
// base64 写临时文件 → InnerAudioContext 播放
wx.getFileSystemManager().writeFileSync(filePath, base64, 'base64')
const audio = wx.createInnerAudioContext()
audio.obeyMuteSwitch = false  // 关键！否则 iPhone 静音键开启时没声音
audio.src = filePath
audio.play()
```

### 声音克隆 VoiceClone

- 服务 `trtc`，action `VoiceClone`，version `2019-07-22`
- 参数：
  - `SdkAppId`：TRTC 应用 ID
  - `VoiceName`：**仅字母数字下划线，最长 36 字符**（云端做正则清洗 `[^a-zA-Z0-9_]` → `_` + 截断）
  - `PromptAudio`：base64 mp3（15-30 秒录音最佳）
  - `PromptText`：录音时朗读的引导文本（必须和录音内容一致！）
  - `Model:'flow_02_turbo'`
- 返回 `Response.VoiceId`（`v-xxx` 格式），存入云数据库 `voices` 集合
- **双重时长校验**：前端录音计时器 <6 秒拒绝；云端音频 <20KB（mp3 48kbps ≈ 6KB/s）拒绝
- **引导文案**：约 60 字（正常语速 15-20 秒），如"宝贝，我是你的爸爸。今天你想知道什么呢？……"，切换爸爸/妈妈时正则替换称呼

## 五、前端关键实现

### config.js（三模式开关）

```js
module.exports = {
  BACKEND_MODE: 'cloud',        // 'mock' | 'cloud' | 'http'
  CLOUD_ENV: 'your-cloud-env-id',
  CLOUD_FUNCTION: 'ask',
  CLOUD_VOICE_FUNCTION: 'voice',
  DEFAULT_VOICE_ID: '101001',   // 基础TTS数字音色
  HTTP_BASE_URL: 'http://192.168.x.x:3000',  // 仅 http 模式
  VOICE_BASE_URL: 'http://192.168.x.x:3000'
}
```

### app.js 云开发初始化

- `onLaunch` 中仅 cloud 模式调 `wx.cloud.init`
- `CLOUD_ENV` 为占位符时不传 env（用控制台默认环境）
- 检测基础库版本 <2.2.3 弹窗提示

### 前端超时配置

- callFunction ask：25 秒（云端 20s + 余量）
- callFunction voice：65 秒（云端 60s + 余量）
- 云函数内 https 请求自身设 28-30s 超时

### 收藏功能（本地 Storage）

- Storage key：`baba_why_favorites`（可按你的应用名改前缀），上限 200 条，添加时按 question+answer 去重
- 结构：`{id, question, answer, age, createdAt}`，新条目 unshift 到头部
- 直接用模板 [templates/utils-favorites.js](templates/utils-favorites.js)
- 聊天页每条回答卡片有收藏/取消收藏按钮，用消息的 `favorited` 布尔值控制 UI 状态（☆/⭐）

### 按钮布局（微信小程序 UI 注意事项）

- **不要用 `<text>` 做带 emoji 的按钮**：`<text>` 是行内元素，emoji 和文字基线不一致会错位
- 正确做法：外层 `<view class="btn">` + 内层 `<text class="icon">` + `<text class="label">`，CSS 用 `display:flex; align-items:center; justify-content:center; line-height:1`

### 追问语音输入

- 追问面板输入框旁放圆形麦克风按钮
- `bindtouchstart` 开始录音 / `bindtouchend` 停止并识别
- 识别结果填入 textarea（`followText`），用户可确认或编辑后再提交

### "问下一个问题"回首页清空

- 聊天页用 `wx.reLaunch({ url: '/pages/index/index?clear=1' })`（reLaunch 保证页面栈重置）
- 首页 `onLoad(options)` 检测 `options.clear === '1'` 时 `setData({ question: '' })`

## 六、必须避开的坑（实战总结）

1. **不要在云函数里装 `tencentcloud-sdk-nodejs`**：该包含腾讯云全部服务，超 100MB，云端安装依赖会超时导致部署失败（微信开发者工具预览时自动上传云函数也会卡在 26% 失败）。**解决方案**：用原生 `https` + `crypto` 手写 TC3 签名，云函数仅 11KB，零外部依赖秒级部署。

2. **录音不要用 wav 格式**：wav 是无损未压缩，16kHz 单声道每秒约 32KB，30 秒 base64 后超 1MB，触发微信云函数 `data exceed max size` 错误。**用 mp3**（16kHz/单声道/48kbps），30 秒仅约 240KB。腾讯云 ASR 和 VoiceClone 都支持 mp3。

3. **云函数默认超时 3 秒不够**：AI 回答和语音克隆都需要更长时间，报错码 `-504002`（函数执行失败）或 `-504003`（超时）。**ask 设 20 秒，voice 设 60 秒**（在云函数目录的 config.json 配置），前端 callFunction 超时相应放大。

4. **基础 TTS 单次限 150 汉字**：长回答需按标点切分、分段合成、`Buffer.concat` 拼接 mp3 后再返回。

5. **iPhone 静音键导致 TTS 无声**：必须设 `audio.obeyMuteSwitch = false`。

6. **模型输出 JSON 不稳定**：即使指定 `response_format:{type:'json_object'}`，模型仍可能返回带 Markdown 代码块或纯文本。必须实现 5 级 JSON 解析容错（直接 parse → 去代码块 → 抽 `{}` → 抽 `[]` → 兜底包原文），最终把原文当 answer 返回。

7. **VoiceClone 的 PromptText 必须与录音内容一致**：如果引导文案为空或和录音不匹配，克隆会失败或音色质量差。前端引导文案必须在 data 中定义并传给云函数。

8. **VoiceName 格式严格**：只允许字母数字下划线，最长 36 字符。用 `role + 时间戳` 生成（如 `bw_dad_lx3k9m`），云端再做一次正则清洗。

9. **TRTC_SDK_APP_ID 不是腾讯云 AppID**：是 TRTC 控制台创建应用后的 SdkAppId（纯数字），需要在腾讯云 TRTC 控制台开通服务并获取。

10. **云函数部署冲突**：短时间内多次点击上传部署会报 `FailedOperation.UpdateFunctionCode 当前函数处于Updating状态`。等 1-2 分钟后只点一次。

11. **未配置密钥时优雅降级**：voice 云函数检测到缺少环境变量时返回 `{ok:false, error:'...'}`，前端 toast 提示"语音功能未配置"，文字问答不受影响。

## 七、构建步骤清单

1. **创建小程序项目**：微信开发者工具 → 新建小程序 → 开通云开发
2. **创建 4 个页面**：index / chat / voice / favorites，在 app.json 注册
3. **创建 2 个云函数**：ask（AI）、voice（语音），配置 config.json 超时
4. **配置云函数环境变量**：
   - ask：`API_KEY`（DeepSeek 或其他 OpenAI 兼容 Key）
   - voice：`TENCENT_SECRET_ID`、`TENCENT_SECRET_KEY`、`TRTC_SDK_APP_ID`
5. **开通腾讯云服务**：语音识别（ASR）、语音合成（TTS）、实时音视频 TRTC（含声音克隆）
6. **创建数据库集合**：`voices`（存克隆音色 ID）
7. **部署云函数**：右键 → 上传并部署（云端安装依赖）
8. **前端实现**：参考模板文件
9. **测试流程**：mock 模式看界面 → cloud 模式测文字问答 → 测语音识别 → 测 TTS 播放 → 测声音克隆
10. **发布前检查**：确认真机预览语音正常（尤其 iPhone 静音键）、云函数超时配置生效

## 八、模板文件

**后端/语音（直接复制即可用，已通过实战验证）**：
- [templates/cloudfunction-ask.js](templates/cloudfunction-ask.js) — AI 问答云函数完整代码（零依赖，原生 https）
- [templates/cloudfunction-voice.js](templates/cloudfunction-voice.js) — 语音云函数完整代码（TC3 签名 + ASR + TTS 双引擎 + VoiceClone）
- [templates/utils-voice.js](templates/utils-voice.js) — 前端语音工具（录音/ASR/TTS/克隆/播放）
- [templates/system-prompt.md](templates/system-prompt.md) — AI 系统提示词模板

**前端/胶水层（直接复制即可用）**：
- [templates/utils-ai.js](templates/utils-ai.js) — 前端 AI 请求层（mock/cloud/http 三模式自动切换，含 mock 假数据）
- [templates/utils-favorites.js](templates/utils-favorites.js) — 收藏功能本地存储工具
- [templates/app.js](templates/app.js) — 小程序入口（云开发初始化 + 环境检测）
- [templates/config.js](templates/config.js) — 三模式配置文件

**前端数据契约（务必先读，决定页面怎么写）**：
- [frontend-contracts.md](frontend-contracts.md) — **页面 data 结构、messages 消息格式、云数据库 voices 集合 schema 与权限设置、追问状态机、HTTP 接口契约、录音权限、工程配置清单**

> **建议实现顺序**：先读 frontend-contracts.md 了解数据结构 → 复制 5 个后端/工具模板 → 照契约编写 4 个页面 → mock 模式验证界面 → 切 cloud 模式配密钥联调。

## 九、新手最容易卡住的 3 个环节（重点排查）

1. **声音克隆全链路**：需先在腾讯云 TRTC 控制台开通服务并拿到 SdkAppId（注意不是腾讯云 AppID，见踩坑 #9）；克隆成功后要把 VoiceId 写入云数据库 `voices` 集合，且该集合**权限必须设置为"所有用户可读可写"或自定义安全规则**（见 frontend-contracts.md 第 1 节），否则前端写库报权限错误；PromptText 必须与录音朗读内容一致。

2. **页面消息格式对齐**：chat 页发给云函数的 context 中，孩子消息的 `role` 必须是 **`'child'`**（不是 `'user'`），云函数 formatHistory 据此判断。messages 展示列表用 `kind: 'answer'|'child'|'game'` 区分渲染。详见 frontend-contracts.md 第 2 节。

3. **云函数部署与超时**：必须右键云函数目录「上传并部署：云端安装依赖」；ask 超时配 20 秒、voice 配 60 秒（config.json）；部署时若报 Updating 状态冲突，等 1-2 分钟再点一次，不要狂点。
