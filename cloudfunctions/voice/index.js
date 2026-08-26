// ============================================================
// 《爸爸，我为什么？》语音云函数 voice
// 负责：语音识别(ASR) + 语音合成(TTS) + 父母声音克隆(VoiceClone)，转发到腾讯云。
// 密钥只存在于云函数环境变量，不进前端。
//
// 环境变量（云开发控制台 -> 云函数 -> voice -> 配置 -> 环境变量）：
//   TENCENT_SECRET_ID   必填，腾讯云 SecretId
//   TENCENT_SECRET_KEY  必填，腾讯云 SecretKey
//   TRTC_SDK_APP_ID     必填，TRTC 的 SdkAppId（开通「实时音视频 TRTC」后获得）
//
// 入参（前端 wx.cloud.callFunction 的 data）：
//   { voiceAction: 'asr',  audio: '<base64 mp3>' }                       -> { ok:true, data:{ text } }
//   { voiceAction: 'tts',  text: '...', voiceId?: '<音色ID>' }           -> { ok:true, data:{ audio:'<base64 mp3>' } }
//   { voiceAction: 'clone', audio: '<base64 mp3>', voiceName, role }    -> { ok:true, data:{ voiceId } }
// 未配置腾讯云密钥时返回 ok:false，前端会优雅提示“语音功能未配置”，不影响文字问答。
// ============================================================

const cloud = require('wx-server-sdk')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

// 默认 / 预设音色（TRTC 精品音色，均为字符串 ID）
// 详见腾讯云 TTS 音色清单；这里选几个适合亲子场景的温和音色
const PRESET_VOICES = {
  gentle_female: 'v-female-R2s4N9qJ', // 温柔姐姐
  natural_male: 'v-male-W1tH9jVc',    // 自然男声
  warm_male_teacher: 'v-male-X6h4TvP9' // 暖心男老师
}

// ---------------------- 腾讯云客户端（v4 写法，懒加载）----------------------
let asrClient = null
let trtcClient = null
let trtcSdkAppId = null

function getAsrClient() {
  if (asrClient) return asrClient
  const secretId = process.env.TENCENT_SECRET_ID
  const secretKey = process.env.TENCENT_SECRET_KEY
  if (!secretId || !secretKey) {
    console.error('[ASR] 缺少腾讯云密钥环境变量')
    return null
  }
  try {
    const tencentcloud = require('tencentcloud-sdk-nodejs')
    asrClient = new tencentcloud.asr.v20190614.Client({
      credential: { secretId, secretKey },
      region: 'ap-guangzhou',
      profile: { httpProfile: { endpoint: 'asr.tencentcloudapi.com', reqTimeout: 15 } }
    })
    return asrClient
  } catch (e) {
    console.error('[ASR] 腾讯云客户端初始化失败:', e && e.message)
    return null
  }
}

// TRTC 客户端同时用于 TTS(TextToSpeech) 与声音克隆(VoiceClone)
function getTrtcClient() {
  if (trtcClient) return trtcClient
  const secretId = process.env.TENCENT_SECRET_ID
  const secretKey = process.env.TENCENT_SECRET_KEY
  const appId = parseInt(process.env.TRTC_SDK_APP_ID || '0', 10)
  if (!secretId || !secretKey) {
    console.error('[TTS] 缺少腾讯云密钥环境变量')
    return null
  }
  if (!appId) {
    console.error('[TTS] 缺少 TRTC_SDK_APP_ID 环境变量（需在腾讯云开通 TRTC 并填入 SdkAppId）')
    return null
  }
  try {
    const tencentcloud = require('tencentcloud-sdk-nodejs')
    trtcClient = new tencentcloud.trtc.v20190722.Client({
      credential: { secretId, secretKey },
      region: 'ap-guangzhou',
      profile: { httpProfile: { endpoint: 'trtc.tencentcloudapi.com', reqTimeout: 30 } }
    })
    trtcSdkAppId = appId
    return trtcClient
  } catch (e) {
    console.error('[TTS] 腾讯云 TRTC 客户端初始化失败:', e && e.message)
    return null
  }
}

// ---------------------- 一句话识别 ASR ----------------------
function doAsr(audio) {
  const client = getAsrClient()
  if (!client) return Promise.reject(new Error('未配置腾讯云密钥（TENCENT_SECRET_ID/KEY），无法使用语音识别'))
  if (!audio) return Promise.reject(new Error('缺少音频数据'))
  return client
    .request('SentenceRecognition', {
      ProjectId: 0,
      SubServiceType: 2, // 一句话识别
      EngSerViceType: '16k_zh',
      SourceType: 1, // 1=语音数据（base64）
      VoiceFormat: 'mp3', // 与前端录音格式一致
      UsrAudioKey: 'baba_why_' + Date.now(),
      Data: audio,
      DataLen: Math.ceil(Buffer.from(audio, 'base64').length)
    })
    .then((resp) => resp.Result || '')
    .catch((err) => Promise.reject(new Error('语音识别失败: ' + (err && err.message ? err.message : err))))
}

// ---------------------- 语音合成 TTS（TRTC 新接口，支持克隆音色）----------------------
function doTts(text, voiceId) {
  const client = getTrtcClient()
  if (!client) return Promise.reject(new Error('未配置腾讯云密钥或 TRTC_SDK_APP_ID，无法使用语音合成'))
  if (!text) return Promise.reject(new Error('缺少文本'))
  const useVoiceId = voiceId || PRESET_VOICES.gentle_female
  return client
    .TextToSpeech({
      Text: text,
      Voice: { VoiceId: useVoiceId },
      SdkAppId: trtcSdkAppId,
      Model: 'flow_02_turbo',
      Language: 'zh',
      AudioFormat: { AudioType: 'mp3', SampleRate: 16000, AudioChannel: 1 }
    })
    .then((resp) => resp.Audio || '')
    .catch((err) => Promise.reject(new Error('语音合成失败: ' + (err && err.message ? err.message : err))))
}

// ---------------------- 父母声音克隆 VoiceClone ----------------------
function doClone(voiceName, audio, promptText) {
  const client = getTrtcClient()
  if (!client) return Promise.reject(new Error('未配置腾讯云密钥或 TRTC_SDK_APP_ID，无法进行声音克隆'))
  if (!audio) return Promise.reject(new Error('缺少音频数据'))
  if (!voiceName) return Promise.reject(new Error('缺少声音名称'))
  return client
    .VoiceClone({
      SdkAppId: trtcSdkAppId,
      VoiceName: voiceName,
      PromptAudio: audio,
      PromptText: promptText || '',
      Model: 'flow_02_turbo'
    })
    .then((resp) => resp.VoiceId || '')
    .catch((err) => Promise.reject(new Error('声音克隆失败: ' + (err && err.message ? err.message : err)))
}

// ---------------------- 入口 ----------------------
exports.main = async (event) => {
  const t0 = Date.now()
  const action = event.voiceAction
  console.log('[voice] 收到请求 action=', action,
    '| 是否有 SECRET_ID=', !!process.env.TENCENT_SECRET_ID,
    '| 是否有 SECRET_KEY=', !!process.env.TENCENT_SECRET_KEY,
    '| 是否有 TRTC_SDK_APP_ID=', !!process.env.TRTC_SDK_APP_ID)
  try {
    if (action === 'asr') {
      console.log('[voice] 开始 ASR 识别…')
      const text = await doAsr(event.audio)
      console.log('[voice] ASR 完成，耗时', Date.now() - t0, 'ms，结果长度', (text || '').length)
      return { ok: true, data: { text } }
    }
    if (action === 'tts') {
      console.log('[voice] 开始 TTS 合成，voiceId=', event.voiceId || '(默认预设)')
      const audio = await doTts(event.text, event.voiceId)
      console.log('[voice] TTS 完成，耗时', Date.now() - t0, 'ms，音频长度', (audio || '').length)
      return { ok: true, data: { audio } }
    }
    if (action === 'clone') {
      console.log('[voice] 开始声音克隆，voiceName=', event.voiceName, 'role=', event.role)
      const voiceId = await doClone(event.voiceName, event.audio, event.promptText)
      console.log('[voice] 声音克隆完成，耗时', Date.now() - t0, 'ms，VoiceId=', voiceId)
      return { ok: true, data: { voiceId } }
    }
    return { ok: false, error: '未知的语音动作: ' + action }
  } catch (err) {
    console.error('[voice] 执行失败，耗时', Date.now() - t0, 'ms，错误:', String((err && err.message) ? err.message : err))
    return { ok: false, error: String((err && err.message) ? err.message : err) }
  }
}
