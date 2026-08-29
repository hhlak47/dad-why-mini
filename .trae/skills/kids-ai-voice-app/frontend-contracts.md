# 前端数据契约与页面结构（Frontend Contracts）

本文档规定前端各页面的 `data` 结构、消息格式、云数据库 schema 和权限。
**照此实现即可保证前端与云函数、云数据库、TTS 引擎完全对齐。**

## 1. 云数据库集合 `voices`（声音克隆结果）

### 文档结构

```js
{
  _id: '自动生成',
  role: 'dad',              // 'dad' | 'mom'，用于区分爸爸/妈妈
  voiceId: 'v-abc123xyz',   // 腾讯云 VoiceClone 返回的 VoiceId（v- 开头）
  name: 'bw_dad_lx3k9m',    // 克隆时传给腾讯云的 VoiceName
  createdAt: 1724700000000  // Date.now() 时间戳
}
```

### 写入（克隆成功后，在 voice 页面）

```js
const db = wx.cloud.database()
db.collection('voices').add({
  data: { role: 'dad', voiceId: 'v-xxx', name: voiceName, createdAt: Date.now() }
})
```

### 读取（chat 页组装音色选项）

```js
db.collection('voices').get().then((res) => {
  const list = res.data || []
  const options = [{ id: config.DEFAULT_VOICE_ID, name: '默认女声' }]
  list.forEach((v) => {
    if (v.role === 'dad') options.push({ id: v.voiceId, name: '爸爸' })
    if (v.role === 'mom') options.push({ id: v.voiceId, name: '妈妈' })
  })
  this.setData({ voiceOptions: options, currentVoiceId: config.DEFAULT_VOICE_ID })
})
```

### ⚠️ 数据库权限设置（新手必做，否则写库报错）

在微信开发者工具 → 云开发控制台 → 数据库 → 选中 `voices` 集合 → 权限设置：
- 开发期最简单：选 **「所有用户可读，仅创建者可读写」** 或 **「所有用户可读写」**
- 正式发布建议：自定义安全规则，仅允许用户写自己创建的记录
- 如果不设置，默认权限下前端 `add()` 会报权限错误

## 2. chat 页面（核心状态机）

### data 结构

```js
data: {
  question: '',          // 原始问题（从首页 options.q 传入）
  age: 4,                // 孩子年龄（options.age）
  messages: [],          // 【展示列表】见下方消息结构
  context: [],           // 【发给模型的历史】[{ role:'child'|'assistant', content }]
  loading: false,
  loadingText: '',
  error: false,
  showFollow: false,     // 追问输入面板是否展开
  followText: '',        // 追问输入框内容
  followRounds: 0,       // 已追问轮数
  followDisabled: false, // 达到 MAX_FOLLOW_ROUNDS(5) 后置 true
  lastAction: null,      // { action, extra } 用于失败重试
  scrollAnchor: 'anchor-0',
  voiceOptions: [],      // [{id, name}] 音色选项
  currentVoiceId: '',    // 当前选中音色
  // 追问语音输入状态
  followRecording: false,
  followRecognizing: false
}
```

### messages 展示列表的三种消息结构

```js
// 1) AI 回答卡片（answer / simpler_answer / follow_up 都用这个）
{ id: 0, kind: 'answer', type: 'answer', content: '...', favorited: false }

// 2) 孩子追问气泡
{ id: 1, kind: 'child', content: '那为什么...' }

// 3) 游戏卡片
{ id: 2, kind: 'game', title: '...', duration: '3分钟', materials: '什么都不用',
  steps: ['步骤1','步骤2'], question: '最后问孩子的话' }
```

### 发给云函数 ask 的 payload（务必与云函数 buildUserContent 对齐）

```js
{
  action: 'answer',        // 'answer' | 'simpler' | 'followup' | 'game'
  childAge: 4,
  originalQuestion: '为什么月亮跟着我',
  messages: this.data.context,   // [{role:'child'|'assistant', content}]
  followUpQuestion: '',          // 仅 followup 时填
  lastAnswer: '...'              // 仅 simpler 时填（上一版回答）
}
```

**关键对齐点**：context 里孩子的消息 `role` 必须是 **`'child'`**（不是 `'user'`），因为云函数 `formatHistory` 用 `m.role === 'child' ? '孩子' : '助手'` 判断。

### ⚠️ onLoad 初始化（新手易漏）

进入 chat 页时，要把首页传来的原始问题**先压入 context**，这样后续 followup 时模型才有完整历史：

```js
onLoad(options) {
  const q = decodeURIComponent(options.q || '')
  const age = parseInt(options.age, 10) || 4
  this.setData({
    question: q,
    age: age,
    context: [{ role: 'child', content: q }]   // 初始问题作为第一条 child 消息
  })
  this.loadVoices()        // 读取克隆音色
  this.runAction('answer') // 进页自动请求第一个回答
}
```

### 四个动作按钮

| 按钮 | action | 说明 |
|------|--------|------|
| 🐣 再简单一点 | `simpler` | extra 带 `lastAnswer`（取 context 最后一条 assistant） |
| 🙋 她还在追问 | `followup` | 展开追问面板，提交后 followRounds+1，达 5 轮禁用 |
| 🎮 一起做游戏 | `game` | 返回 game 类型，渲染游戏卡片 |

### 追问提交流程

```js
onSubmitFollow() {
  const text = this.data.followText.trim()
  if (!text) { wx.showToast({title:'她又问了什么呀？', icon:'none'}); return }
  const rounds = this.data.followRounds + 1
  // 1) 展示列表加孩子气泡
  // 2) context 加 { role:'child', content:text }
  // 3) 关闭面板、清空 followText
  // 4) followRounds=rounds, followDisabled = rounds>=5
  // 5) runAction('followup', { followUpQuestion: text })
}
```

### 回答追加流程（_appendResult）

- AI 返回 `{type:'answer'|'simpler_answer'|'follow_up', content}`：
  - messages 加 `{kind:'answer', content, favorited:false}`
  - context 加 `{role:'assistant', content}`
- AI 返回 `{type:'game', ...}`：messages 加 `{kind:'game', ...}`，**不加 context**

### 音色选择与 TTS 播放

```js
onSpeak(e) {
  const content = e.currentTarget.dataset.content
  const voiceId = this.data.currentVoiceId || config.DEFAULT_VOICE_ID
  voice.textToSpeech(content, voiceId)  // voiceId 纯数字走基础TTS，v- 开头走TRTC
}
```

## 3. voice 页面（声音克隆）

### data 结构

```js
data: {
  role: 'dad',           // 'dad' | 'mom'，tab 切换
  guideText: '宝贝，我是你的爸爸。今天你想知道什么呢？...', // 约60字引导文案
  recording: false,
  duration: 0,           // 录音秒数
  recognizing: false,    // 克隆提交中
  dadDone: false,        // 爸爸是否已克隆（查 voices 集合）
  momDone: false
}
```

### 引导文案要求

- 约 60 字，正常语速 15-20 秒读完
- 切妈妈时把"爸爸"替换成"妈妈"：`guideText.replace(/爸爸/g, '妈妈')`
- **这段文案必须作为 PromptText 传给克隆接口，且要和录音朗读内容一致**

### 克隆调用

```js
const voiceName = 'bw_' + role + '_' + Date.now().toString(36)  // 仅字母数字下划线
voice.cloneVoice(base64Audio, voiceName, role, guideText)
  .then((voiceId) => {
    // 存云数据库 voices 集合（见第1节）
    // 标记 dadDone/momDone = true
  })
```

### 时长校验

- 前端：录音计时器，<6 秒拒绝提交（提示录 10 秒以上，建议 15-30 秒）
- 云端：音频 <20KB 拒绝（mp3 48kbps ≈ 6KB/s）

## 4. favorites 收藏（本地 Storage）

- Storage key：`baba_why_favorites`（可按你的应用名改前缀）
- 结构：`[{ id, question, answer, age, createdAt }]`，上限 200 条，新条目 unshift 到头部
- 添加时按 `question + answer` 去重
- 完整实现直接用模板 `utils-favorites.js`
- chat 页每条回答卡片有收藏按钮，用消息的 `favorited` 布尔值控制 UI（☆/⭐）

## 5. index 首页

### data

```js
data: {
  question: '',
  ages: [3, 4, 5, 6],
  age: 4,               // 默认读 storage 记住的上次选择
  recording: false,
  recognizing: false
}
```

### 跳转聊天页

```js
wx.navigateTo({ url: `/pages/chat/chat?q=${encodeURIComponent(q)}&age=${age}` })
```

### "问下一个问题"回来清空

- chat 页：`wx.reLaunch({ url: '/pages/index/index?clear=1' })`
- 首页 `onLoad(options)`：`if (options.clear === '1') this.setData({ question: '' })`

## 6. mock 模式下的语音行为

mock 模式只模拟 AI 文字问答（utils-ai.js 已内置 600ms 假数据）。
**语音功能（ASR/TTS/克隆）在 mock 模式下不可用**：
- 录音按钮可点击，但识别/合成会失败
- 前端应 catch 错误后 toast「语音功能需配置云开发（cloud 模式）」
- 不影响文字问答体验——这是故意的降级设计（对应踩坑 #11）

## 7. HTTP 模式接口契约（仅当 BACKEND_MODE='http'）

> 推荐直接用 cloud 模式，可跳过本节。HTTP 模式需要自己跑一个 Node 服务器。

服务器需实现 3 个 POST 接口，请求/响应格式与云函数完全一致：

| 接口 | 请求体 | 响应 |
|------|--------|------|
| `POST /ask` | `{action, childAge, originalQuestion, messages, followUpQuestion, lastAnswer}` | `{ok:true, data:{type,content\|...}}` 或 `{ok:false, error}` |
| `POST /asr` | `{audio: '<base64 mp3>'}` | `{ok:true, data:{text}}` 或 `{ok:false, error}` |
| `POST /tts` | `{text, voiceId}` | `{ok:true, data:{audio:'<base64 mp3>'}}` 或 `{ok:false, error}` |

- 服务器逻辑与云函数 ask/voice 同构（同样的 System Prompt、buildUserContent、extractJSON、TC3 签名）
- 环境变量同云函数：`API_KEY`、`API_BASE`、`MODEL`、`TENCENT_SECRET_ID`、`TENCENT_SECRET_KEY`、`TRTC_SDK_APP_ID`
- 手机和电脑必须连同一 WiFi；开发者工具需勾选「不校验合法域名」
- WiFi 重连后电脑局域网 IP 可能变化，需同步改 config.js

## 8. 工程配置清单（新手易漏）

### project.config.json 关键项

```json
{
  "cloudfunctionRoot": "cloudfunctions/",
  "appid": "你的小程序AppID",
  "setting": { "es6": true, "postcss": true }
}
```

### app.json 注册页面

```json
{
  "pages": [
    "pages/index/index",
    "pages/chat/chat",
    "pages/voice/voice",
    "pages/favorites/favorites"
  ]
}
```

### 录音权限

小程序录音需要用户授权 `scope.record`。首次调用 `wx.getRecorderManager().start()` 时微信会自动弹授权框；若用户拒绝，需在 catch 中引导到设置页：

```js
wx.getSetting({ success: (res) => {
  if (!res.authSetting['scope.record']) {
    wx.authorize({ scope: 'scope.record', fail: () => wx.showModal({ content:'请在设置中开启麦克风权限' }) })
  }
}})
```

### 云函数 package.json 依赖

两个云函数都只需要：`{ "dependencies": { "wx-server-sdk": "~2.6.3" } }`
**不要加 tencentcloud-sdk**（踩坑 #1）。

### 云函数 config.json 超时

- ask：`{ "timeout": 20, "memorySize": 256 }`
- voice：`{ "timeout": 60, "memorySize": 256 }`
