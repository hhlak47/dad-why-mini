// ============================================================
// 《爸爸，我为什么？》云函数 ask
// 负责：调用大模型（默认 DeepSeek，OpenAI 兼容接口），内置 System Prompt 与四种动作 prompt 构建。
// API Key 只存在于云函数环境变量，绝不出现在前端。
//
// 环境变量（在云开发控制台 -> 云函数 -> ask -> 配置 -> 环境变量 中设置）：
//   API_KEY  必填，模型厂商的 API Key
//   API_BASE 选填，默认 https://api.deepseek.com/v1
//   MODEL    选填，默认 deepseek-chat
// ============================================================

const cloud = require('wx-server-sdk')
const https = require('https')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// ---------------------- System Prompt（与 SYSTEM_PROMPT.md 保持一致）----------------------
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

// ---------------------- 工具函数 ----------------------
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
  const apiKey = process.env.API_KEY
  const apiBase = process.env.API_BASE || 'https://api.deepseek.com/v1'
  const model = process.env.MODEL || 'deepseek-chat'

  if (!apiKey) {
    return Promise.reject(new Error('缺少 API_KEY 环境变量，请在云函数环境变量中配置'))
  }

  const body = JSON.stringify({
    model,
    messages,
    temperature: 0.85,
    response_format: { type: 'json_object' }
  })

  const url = new URL(apiBase + '/chat/completions')
  const options = {
    method: 'POST',
    hostname: url.hostname,
    path: url.pathname + url.search,
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + apiKey,
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

// ---------------------- 入口 ----------------------
exports.main = async (event) => {
  try {
    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserContent(event) }
    ]
    const content = await chatWithModel(messages)
    let parsed = extractJSON(content)
    if (!parsed || typeof parsed !== 'object') {
      // JSON 解析失败：直接把模型原始文本当 content 展示，避免白屏
      parsed = { type: 'answer', content: content }
    }
    return { ok: true, data: parsed }
  } catch (err) {
    return { ok: false, error: String((err && err.message) ? err.message : err) }
  }
}
