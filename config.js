// ============================================================
// 《爸爸，我为什么？》小程序配置文件
// API Key 永远不要写在前端代码里，只存在于云端（云函数环境变量 / 服务器环境变量）
// ============================================================

module.exports = {
  // 后端模式，三选一：
  //   'mock'  —— 本地假数据，无需任何账号/Key，先看界面与交互流程（默认，适合刚上手）
  //   'cloud' —— 微信云函数（推荐，需真实 AppID + 云环境 + API Key，免本地服务器、免改 IP）
  //   'http'  —— 自建服务器（server/index.js，需 Node + API Key，手机与电脑同 WiFi）
  BACKEND_MODE: 'cloud',         // 已切到云函数（免本地服务器、换网络不用改 IP）

  // ===== 云函数模式 =====
  CLOUD_ENV: 'cloud1-d8gxvnxs47a96f2b3', // 在「云开发控制台」获取的环境 ID（务必改成你自己的）
  CLOUD_FUNCTION: 'ask',           // AI 问答云函数名
  CLOUD_VOICE_FUNCTION: 'voice',   // 语音识别/合成云函数名

  // ===== 语音音色 =====
  // 默认音色：未做声音克隆时，「念给孩子听」使用的预设音色（TRTC 精品音色字符串 ID）
  // 可选：温柔姐姐 v-female-R2s4N9qJ / 自然男声 v-male-W1tH9jVc / 暖心男老师 v-male-X6h4TvP9
  DEFAULT_VOICE_ID: 'v-female-R2s4N9qJ',
  // 父母克隆出的音色存在云数据库 voices 集合（role: dad / mom），运行时按所选角色读取

  // ===== HTTP 模式（本地 / 自建服务器，仅当 BACKEND_MODE='http' 时使用）=====
  // 填你电脑在当前 WiFi 下的局域网 IP，例如 http://192.168.1.100:3000
  HTTP_BASE_URL: 'http://172.20.209.54:3000',
  // 语音识别 / 合成接口地址（与后端服务器同址即可，留着不填也默认等于 HTTP_BASE_URL）
  VOICE_BASE_URL: 'http://172.20.209.54:3000' // 你 Mac 的局域网 IP（如 WiFi 重连变 IP，需改回）
}
