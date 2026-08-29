// ============================================================
// 《爸爸，我为什么？》本地 / 自建服务器（HTTP 模式备选）
// 作用与云函数完全一致，方便没有云开发环境时，手机与电脑连同一 WiFi 做真机预览。
// 零依赖（AI 部分直连 DeepSeek）；语音识别 / 合成可选腾讯云 SDK，未安装时优雅降级。
// API Key 只存在于这里的环境变量，不进前端。
//
// 运行方式：
//   export API_KEY=sk-xxxx
//   export TENCENT_SECRET_ID=xxx      # 可选：语音识别 / 合成
//   export TENCENT_SECRET_KEY=yyy     # 可选：语音识别 / 合成
//   node server/index.js
// 然后在 config.js 中设置 BACKEND_MODE='http'，HTTP_BASE_URL / VOICE_BASE_URL='http://电脑局域网IP:3000'
// ============================================================

const http = require('http')
const https = require('https')
const crypto = require('crypto')

const PORT = process.env.PORT || 3000
const API_KEY = process.env.API_KEY
const API_BASE = process.env.API_BASE || 'https://api.deepseek.com/v1'
const MODEL = process.env.MODEL || 'deepseek-chat'
const TENCENT_SECRET_ID = process.env.TENCENT_SECRET_ID
const TENCENT_SECRET_KEY = process.env.TENCENT_SECRET_KEY
const TRTC_APP_ID = parseInt(process.env.TRTC_SDK_APP_ID || '0', 10)

const SYSTEM_PROMPT = `你是一名非常擅长和 3–6 岁孩子交流的“亲子好奇心助手”。
你的任务不是展示知识量，也不是代替父母教育孩子。
你的任务是：帮助父母把孩子提出的每一个问题，变成一次孩子听得懂、愿意继续追问，并可能产生亲子互动的探索。
你输出的内容主要由父母读给孩子听。

核心原则：
1. 科学事实必须正确。不要为了儿童化而提供错误知识。对于无法确定的事实，要谨慎表达。
2. 说人话。禁止百科全书式语言。避免专业术语堆砌、长定义、“首先其次最后”式成人报告语言、大量抽象概念。优先生活经验、类比、画面、动作、孩子熟悉的东西。
3. 一次不要解释太多。孩子问一个问题，只解释最核心的一件事，不要顺带教十个知识点。
4. 让父母可以直接念。输出应该像一个成年人自然和孩子说话。不要出现“你可以告诉孩子……”，直接输出父母可以念的内容。
5. 不要把孩子的问题“讲死”。适合时可在最后留一个开放的小问题（你猜呢？/ 要不要我们找找看？/ 那你觉得……？），但不要每次机械添加。
6. 尊重孩子。面对死亡、身体、生育、性别、疾病、情绪、家庭关系、社会差异等问题时，不欺骗、不制造恐惧，给真实、适龄、温和的解释。

安全要求：
不提供危险动作、明火游戏、高处游戏、吞咽物品、涉及药品、电器拆解、独自外出、可能窒息或伤害的游戏。
涉及身体、死亡、疾病等问题，保持真实适龄不制造恐惧，不随意给医学诊断。
若问题明显需要专业人员判断的健康/安全问题，优先提醒父母寻求成年人或专业人员帮助，而不是把内容直接讲给孩子。

输出格式要求：
你必须且只能输出一个 JSON 对象，不要输出任何额外文字、标记或 Markdown 代码块符号。
根据动作，输出对应结构：
- “讲给孩子听” / “再简单一点” / “她还在追问”：{"type":"answer" 或 "simpler_answer" 或 "follow_up", "content":"父母可直接念的回答"}
- “和孩子一起做游戏”：{"type":"game","title":"游戏名字","duration":"3分钟","materials":"什么都不用","steps":["步骤1","步骤2","步骤3"],"question":"最后可以问孩子的一句话"}
回答类 content 控制在规定字数内，避免 Markdown 格式与项目符号。`

function formatHistory(messages) {
  if (!messages || !messages.length) return '（暂无历史对话）'
  return messages
    .map((m) => `${m.role === 'child' ? '孩子' : '助手'}：${m.content}`)
    .join('\n')
}

function buildUserContent(event) {
  const { action, childAge, originalQuestion, messages, followUpQuestion, lastAnswer } = event
  if (action === 'answer') {
    return `孩子年龄：${childAge} 岁\n原始问题：${originalQuestion}\n\n[任务] 请生成一段“讲给孩子听”的回答：判断这个年龄最该理解哪一层；找一个生活化类比；生成父母可直接念给孩子听的回答；80–180 字；不介绍背景知识，不输出父母指导说明。`
  }
  if (action === 'simpler') {
    return `孩子年龄：${childAge} 岁\n原始问题：${originalQuestion}\n上一版回答：\n${lastAnswer}\n\n历史对话：\n${formatHistory(messages)}\n\n[任务] 请“再简单一点”：不要简单缩短上一版，换一个更简单的解释角度；优先用生活具体事物；一句话一个意思；50–120 字；适合父母直接念。`
  }
  if (action === 'followup') {
    return `孩子年龄：${childAge} 岁\n完整会话记录：\n${formatHistory(messages)}\n\n孩子最新追问：${followUpQuestion}\n\n[任务] 请回答孩子的最新追问：理解这是在上一轮基础上的继续提问；不重复前面的解释；回答最新问题；必要时引用前面孩子已听过的比喻；保持适龄表达，80–180 字。`
  }
  if (action === 'game') {
    return `孩子年龄：${childAge} 岁\n原始问题：${originalQuestion}\n当前完整会话：\n${formatHistory(messages)}\n\n[任务] 请生成一个马上能玩的亲子小游戏：与当前问题直接相关、符合年龄、父母孩子共同参与；优先从 找一找 / 猜一猜 / 比一比 / 演一演 / 画一画 / 试一试 中选择；不用准备材料、马上能玩、3 分钟可开始、总体 1–10 分钟；调动身体/观察/想象，最好有“猜一猜”过程；不以讲知识为主，无明显安全风险。`
  }
  return ''
}

// 从模型输出中稳健提取 JSON：先直接解析，再去 Markdown 代码块，再抽取第一个 {...}
function extractJSON(text) {
  const raw = (text || '').trim()
  // 1. 直接解析
  try { return JSON.parse(raw) } catch (e) {}
  // 2. 去除 Markdown 代码块（支持前后带说明文字）
  let cleaned = raw
    .replace(/^[\s\S]*?```[a-zA-Z]*\n?/i, '')
    .replace(/\n?```\s*[\s\S]*$/i, '')
    .trim()
  try { return JSON.parse(cleaned) } catch (e) {}
  // 3. 抽取第一个 {...} 对象
  const objStart = cleaned.indexOf('{')
  const objEnd = cleaned.lastIndexOf('}')
  if (objStart !== -1 && objEnd !== -1 && objEnd > objStart) {
    try { return JSON.parse(cleaned.slice(objStart, objEnd + 1)) } catch (e) {}
  }
  // 4. 抽取第一个 [...] 数组
  const arrStart = cleaned.indexOf('[')
  const arrEnd = cleaned.lastIndexOf(']')
  if (arrStart !== -1 && arrEnd !== -1 && arrEnd > arrStart) {
    try { return JSON.parse(cleaned.slice(arrStart, arrEnd + 1)) } catch (e) {}
  }
  return null
}

// ---------------------- 调用大模型（OpenAI 兼容）----------------------
function chatWithModel(messages) {
  if (!API_KEY) {
    return Promise.reject(new Error('缺少 API_KEY 环境变量，请在启动时 export API_KEY=你的密钥'))
  }

  const body = JSON.stringify({
    model: MODEL,
    messages,
    temperature: 0.85,
    response_format: { type: 'json_object' }
  })

  const url = new URL(API_BASE + '/chat/completions')
  const options = {
    method: 'POST',
    hostname: url.hostname,
    path: url.pathname + url.search,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + API_KEY,
      'Content-Length': Buffer.byteLength(body)
    }
  }

  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let chunks = ''
      res.on('data', (c) => (chunks += c))
      res.on('end', () => {
        if (res.statusCode !== 200) {
          return reject(new Error('模型接口返回 ' + res.statusCode + ': ' + chunks))
        }
        try {
          const json = JSON.parse(chunks)
          const content = json.choices && json.choices[0] && json.choices[0].message.content
          resolve(content)
        } catch (e) {
          reject(new Error('解析模型返回失败: ' + chunks))
        }
      })
    })
    req.on('error', reject)
    req.setTimeout(28000, () => {
      req.destroy()
      reject(new Error('模型接口请求超时'))
    })
    req.write(body)
    req.end()
  })
}

// ============================================================
// 语音能力（可选）：腾讯云 ASR / TTS
// 仅在设置了 TENCENT_SECRET_ID / TENCENT_SECRET_KEY 时启用；未配置则对应接口返回 ok:false。
// SDK 为懒加载：没有装包时也能正常启动，只是语音接口不可用。
// ============================================================
let tencentClient = null
function getTencentClient() {
  if (!TENCENT_SECRET_ID || !TENCENT_SECRET_KEY) return null
  if (tencentClient) return tencentClient
  try {
    const tencentcloud = require('tencentcloud-sdk-nodejs')
    // 腾讯云 SDK v4：各服务挂在 tencentcloud.<service>.v<version>.Client
    const AsrClient = tencentcloud.asr.v20190614.Client
    tencentClient = new AsrClient({
      credential: { secretId: TENCENT_SECRET_ID, secretKey: TENCENT_SECRET_KEY },
      region: 'ap-guangzhou',
      profile: { httpProfile: { endpoint: 'asr.tencentcloudapi.com' } }
    })
    return tencentClient
  } catch (e) {
    console.error('[ASR] 腾讯云客户端初始化失败:', e && e.message)
    return null
  }
}

let ttsClient = null
function getTtsClient() {
  if (!TENCENT_SECRET_ID || !TENCENT_SECRET_KEY) return null
  if (ttsClient) return ttsClient
  try {
    const tencentcloud = require('tencentcloud-sdk-nodejs')
    // 腾讯云 SDK v4：各服务挂在 tencentcloud.<service>.v<version>.Client
    const TtsClient = tencentcloud.tts.v20190823.Client
    ttsClient = new TtsClient({
      credential: { secretId: TENCENT_SECRET_ID, secretKey: TENCENT_SECRET_KEY },
      region: 'ap-guangzhou',
      profile: { httpProfile: { endpoint: 'tts.tencentcloudapi.com' } }
    })
    return ttsClient
  } catch (e) {
    console.error('[TTS] 腾讯云客户端初始化失败:', e && e.message)
    return null
  }
}

// /asr：接收 base64 的 mp3 音频，返回识别文本
function handleAsr(body) {
  const client = getTencentClient()
  if (!client) return Promise.reject(new Error('未配置腾讯云密钥（TENCENT_SECRET_ID/KEY），无法使用语音识别'))
  const audio = (body && body.audio) || ''
  if (!audio) return Promise.reject(new Error('缺少音频数据'))
  return new Promise((resolve, reject) => {
    client.request('SentenceRecognition', {
      ProjectId: 0,
      SubServiceType: 2, // 一句话识别
      EngSerViceType: '16k_zh',
      SourceType: 1, // 1=语音数据（base64）
      VoiceFormat: 'mp3',
      UsrAudioKey: 'baba_why_' + Date.now(),
      Data: audio,
      DataLen: Math.ceil(Buffer.from(audio, 'base64').length)
    }).then((resp) => {
      const text = resp.Result || ''
      resolve(text)
    }).catch((err) => reject(new Error('语音识别失败: ' + (err && err.message ? err.message : err))))
  })
}

// /tts：接收文本，返回 base64 的 mp3 音频
// 混合路由：克隆音色（v-xxx）走 TRTC TTS，预设音色走基础 TTS（更便宜）
function splitTextForTts(text, maxLen) {
  if (!text || text.length <= maxLen) return [text || '']
  const chunks = []
  let remaining = text
  const punctuation = ['。', '！', '？', '；', '，', '、', ' ', '.', '!', '?', ';', ',', '\n']
  while (remaining.length > maxLen) {
    const slice = remaining.slice(0, maxLen)
    let splitAt = -1
    for (let i = slice.length - 1; i >= 0; i--) {
      if (punctuation.includes(slice[i])) { splitAt = i + 1; break }
    }
    if (splitAt <= 0) splitAt = maxLen
    chunks.push(remaining.slice(0, splitAt))
    remaining = remaining.slice(splitAt)
  }
  if (remaining) chunks.push(remaining)
  return chunks
}

function sha256Hmac(message, secret) {
  return crypto.createHmac('sha256', secret).update(message).digest()
}

function hexSha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function tencentRequest(service, action, payload, region, version) {
  if (!TENCENT_SECRET_ID || !TENCENT_SECRET_KEY) {
    return Promise.reject(new Error('Missing TENCENT_SECRET_ID / TENCENT_SECRET_KEY env vars'))
  }
  const host = service + '.tencentcloudapi.com'
  const payloadStr = JSON.stringify(payload || {})
  const timestamp = Math.floor(Date.now() / 1000)
  const date = new Date(timestamp * 1000).toISOString().slice(0, 10)

  const canonicalHeaders =
    'content-type:application/json; charset=utf-8\n' +
    'host:' + host + '\n' +
    'x-tc-action:' + action.toLowerCase() + '\n'
  const signedHeaders = 'content-type;host;x-tc-action'
  const canonicalRequest = [
    'POST', '/', '', canonicalHeaders, signedHeaders, hexSha256(payloadStr)
  ].join('\n')

  const credentialScope = date + '/' + service + '/tc3_request'
  const stringToSign = [
    'TC3-HMAC-SHA256', timestamp, credentialScope, hexSha256(canonicalRequest)
  ].join('\n')

  const secretDate = sha256Hmac(date, 'TC3' + TENCENT_SECRET_KEY)
  const secretService = sha256Hmac(service, secretDate)
  const secretSigning = sha256Hmac('tc3_request', secretService)
  const signature = crypto.createHmac('sha256', secretSigning).update(stringToSign).digest('hex')

  const authorization =
    'TC3-HMAC-SHA256 Credential=' + TENCENT_SECRET_ID + '/' + credentialScope +
    ', SignedHeaders=' + signedHeaders + ', Signature=' + signature

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: host, port: 443, path: '/', method: 'POST',
      headers: {
        'Authorization': authorization,
        'Content-Type': 'application/json; charset=utf-8',
        'X-TC-Action': action,
        'X-TC-Timestamp': timestamp.toString(),
        'X-TC-Version': version,
        'X-TC-Region': region || 'ap-guangzhou'
      },
      timeout: 30000
    }, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => {
        try {
          const json = JSON.parse(data)
          if (json.Response && json.Response.Error) {
            return reject(new Error(json.Response.Error.Message || 'Tencent Cloud API error'))
          }
          resolve(json.Response || {})
        } catch (e) {
          reject(new Error('Failed to parse response: ' + data.slice(0, 200)))
        }
      })
    })
    req.on('error', reject)
    req.setTimeout(30000, () => req.destroy(new Error('Request timeout (30s)')))
    req.write(payloadStr)
    req.end()
  })
}

function doTrtcTts(text, voiceId) {
  if (!TRTC_APP_ID) return Promise.reject(new Error('Missing TRTC_SDK_APP_ID env var'))
  return tencentRequest('trtc', 'TextToSpeech', {
    Text: text,
    Voice: { VoiceId: voiceId },
    SdkAppId: TRTC_APP_ID,
    Model: 'flow_02_turbo',
    Language: 'zh',
    AudioFormat: { Format: 'mp3', SampleRate: 16000, Bitrate: 64 }
  }, 'ap-guangzhou', '2019-07-22').then((resp) => resp.Audio || '')
}

function doBasicTts(text, voiceType) {
  const chunks = splitTextForTts(text, 150)
  const client = getTtsClient()
  if (!client) return Promise.reject(new Error('未配置腾讯云密钥，无法使用语音合成'))

  return chunks.reduce((chain, chunk, idx) => {
    return chain.then((acc) => {
      return client.request('TextToVoice', {
        Text: chunk,
        SessionId: 'baba_why_' + Date.now() + '_' + idx,
        Volume: 5,
        Speed: 0,
        VoiceType: voiceType || 101001,
        Codec: 'mp3',
        SampleRate: 16000
      }).then((resp) => {
        const buf = Buffer.from(resp.Audio || '', 'base64')
        return Buffer.concat([acc, buf])
      })
    })
  }, Promise.resolve(Buffer.alloc(0))).then((fullBuf) => fullBuf.toString('base64'))
}

function handleTts(body) {
  if (!TENCENT_SECRET_ID || !TENCENT_SECRET_KEY) {
    return Promise.reject(new Error('未配置腾讯云密钥（TENCENT_SECRET_ID/KEY），无法使用语音合成'))
  }
  const text = (body && body.text) || ''
  if (!text) return Promise.reject(new Error('缺少文本'))

  const voiceId = body.voiceId || ''
  const isNumericVoice = /^\d+$/.test(voiceId)
  const useBasicEngine = !voiceId || isNumericVoice

  if (!useBasicEngine) {
    console.log('[TTS] using TRTC engine for cloned voice:', voiceId)
    return doTrtcTts(text, voiceId)
  }
  const voiceType = parseInt(voiceId, 10) || 101001
  console.log('[TTS] using basic engine, voiceType:', voiceType)
  return doBasicTts(text, voiceType)
}

// ============================================================
// HTTP 路由
// ============================================================
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', 'content-type')
  res.setHeader('Content-Type', 'application/json')

  // 预检
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    return res.end()
  }

  if (req.method === 'POST' && req.url === '/ask') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', async () => {
      try {
        const event = JSON.parse(body || '{}')
        const messages = [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserContent(event) }
        ]
        const content = await chatWithModel(messages)
        let parsed = extractJSON(content)
        if (!parsed || typeof parsed !== 'object') {
          parsed = { type: 'answer', content: content }
        }
        res.end(JSON.stringify({ ok: true, data: parsed }))
      } catch (err) {
        res.end(JSON.stringify({ ok: false, error: String((err && err.message) ? err.message : err) }))
      }
    })
    return
  }

  if (req.method === 'POST' && req.url === '/asr') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}')
        const text = await handleAsr(data)
        res.end(JSON.stringify({ ok: true, data: { text } }))
      } catch (err) {
        res.end(JSON.stringify({ ok: false, error: String((err && err.message) ? err.message : err) }))
      }
    })
    return
  }

  if (req.method === 'POST' && req.url === '/tts') {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', async () => {
      try {
        const data = JSON.parse(body || '{}')
        const audio = await handleTts(data)
        res.end(JSON.stringify({ ok: true, data: { audio } }))
      } catch (err) {
        res.end(JSON.stringify({ ok: false, error: String((err && err.message) ? err.message : err) }))
      }
    })
    return
  }

  res.statusCode = 404
  res.end(JSON.stringify({ ok: false, error: 'Not Found' }))
})

server.listen(PORT, () => {
  console.log(`《爸爸，我为什么？》本地服务已启动: http://localhost:${PORT}`)
  console.log('  接口：/ask（AI 回答）  /asr（语音识别）  /tts（语音合成）')
  if (!API_KEY) {
    console.warn('⚠️ 未检测到 API_KEY 环境变量，调用 /ask 时会报错。请先 export API_KEY=你的密钥')
  }
  if (!TENCENT_SECRET_ID || !TENCENT_SECRET_KEY) {
    console.warn('ℹ️ 未检测到 TENCENT_SECRET_ID / TENCENT_SECRET_KEY，语音输入/播放功能将不可用（不影响文字问答）。')
  }
})
