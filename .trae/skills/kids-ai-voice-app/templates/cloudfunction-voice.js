// ============================================================
// voice cloud function - zero dependency (native https only)
// ASR (SentenceRecognition) + TTS (TextToSpeech) + VoiceClone
// Uses Tencent Cloud TC3-HMAC-SHA256 signature directly
// ============================================================

var cloud = require('wx-server-sdk');
var https = require('https');
var crypto = require('crypto');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

var SECRET_ID = process.env.TENCENT_SECRET_ID || '';
var SECRET_KEY = process.env.TENCENT_SECRET_KEY || '';
var TRTC_APP_ID = parseInt(process.env.TRTC_SDK_APP_ID || '0', 10);

var PRESET_VOICES = {
  gentle_female: 'v-female-R2s4N9qJ',
  natural_male: 'v-male-W1tH9jVc',
  warm_male_teacher: 'v-male-X6h4TvP9'
};

// ============================================================
// TC3-HMAC-SHA256 signing + HTTPS request helper
// ============================================================
function sha256(message, secret) {
  return crypto.createHmac('sha256', secret).update(message).digest();
}

function hexSha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

// Call Tencent Cloud API with TC3 signature
// service: 'asr' | 'trtc'
// action: API action name
// payload: request body object
// region: e.g. 'ap-guangzhou'
// version: API version e.g. '2019-06-14'
function tencentRequest(service, action, payload, region, version) {
  return new Promise(function (resolve, reject) {
    if (!SECRET_ID || !SECRET_KEY) {
      return reject(new Error('Missing TENCENT_SECRET_ID / TENCENT_SECRET_KEY env vars'));
    }

    var host = service + '.tencentcloudapi.com';
    var endpoint = '/';
    var payloadStr = JSON.stringify(payload || {});
    var timestamp = Math.floor(Date.now() / 1000);
    var date = new Date(timestamp * 1000).toISOString().slice(0, 10);

    // Step 1: Canonical request
    var canonicalUri = endpoint;
    var canonicalQueryString = '';
    var canonicalHeaders =
      'content-type:application/json; charset=utf-8\n' +
      'host:' + host + '\n' +
      'x-tc-action:' + action.toLowerCase() + '\n';
    var signedHeaders = 'content-type;host;x-tc-action';
    var hashedRequestPayload = hexSha256(payloadStr);
    var canonicalRequest = [
      'POST',
      canonicalUri,
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      hashedRequestPayload
    ].join('\n');

    // Step 2: String to sign
    var algorithm = 'TC3-HMAC-SHA256';
    var credentialScope = date + '/' + service + '/tc3_request';
    var hashedCanonicalRequest = hexSha256(canonicalRequest);
    var stringToSign = [
      algorithm,
      timestamp,
      credentialScope,
      hashedCanonicalRequest
    ].join('\n');

    // Step 3: Signature
    var secretDate = sha256(date, 'TC3' + SECRET_KEY);
    var secretService = sha256(service, secretDate);
    var secretSigning = sha256('tc3_request', secretService);
    var signature = crypto.createHmac('sha256', secretSigning).update(stringToSign).digest('hex');

    // Step 4: Authorization
    var authorization =
      algorithm + ' ' +
      'Credential=' + SECRET_ID + '/' + credentialScope + ', ' +
      'SignedHeaders=' + signedHeaders + ', ' +
      'Signature=' + signature;

    var options = {
      hostname: host,
      port: 443,
      path: endpoint,
      method: 'POST',
      headers: {
        'Authorization': authorization,
        'Content-Type': 'application/json; charset=utf-8',
        'X-TC-Action': action,
        'X-TC-Timestamp': timestamp.toString(),
        'X-TC-Version': version,
        'X-TC-Region': region || 'ap-guangzhou'
      },
      timeout: 30000
    };

    var req = https.request(options, function (res) {
      var data = '';
      res.on('data', function (chunk) { data += chunk; });
      res.on('end', function () {
        try {
          var json = JSON.parse(data);
          if (json.Response && json.Response.Error) {
            var err = json.Response.Error;
            var e = new Error(err.Message || 'Tencent Cloud API error');
            e.code = err.Code;
            e.requestId = json.Response.RequestId || '';
            return reject(e);
          }
          resolve(json.Response || {});
        } catch (parseErr) {
          reject(new Error('Failed to parse response: ' + data.slice(0, 200)));
        }
      });
    });

    req.on('error', function (err) {
      reject(new Error('Network error: ' + (err && err.message ? err.message : String(err))));
    });

    req.setTimeout(30000, function () {
      req.destroy(new Error('Request timeout (30s)'));
    });

    req.write(payloadStr);
    req.end();
  });
}

// ============================================================
// ASR - one sentence recognition
// ============================================================
function doAsr(audio) {
  if (!audio) return Promise.reject(new Error('Missing audio data'));
  var audioBuf = Buffer.from(audio, 'base64');
  console.log('[ASR] audio size:', Math.round(audioBuf.length / 1024), 'KB');

  return tencentRequest('asr', 'SentenceRecognition', {
    ProjectId: 0,
    SubServiceType: 2,
    EngSerViceType: '16k_zh',
    SourceType: 1,
    VoiceFormat: 'mp3',
    UsrAudioKey: 'baba_why_' + Date.now(),
    Data: audio,
    DataLen: audioBuf.length
  }, 'ap-guangzhou', '2019-06-14').then(function (resp) {
    return resp.Result || '';
  });
}

// ============================================================
// TTS - text to speech (TRTC new API, supports cloned voices)
// ============================================================
function doTts(text, voiceId) {
  if (!TRTC_APP_ID) return Promise.reject(new Error('Missing TRTC_SDK_APP_ID env var'));
  if (!text) return Promise.reject(new Error('Missing text'));
  var useVoiceId = voiceId || PRESET_VOICES.gentle_female;

  return tencentRequest('trtc', 'TextToSpeech', {
    Text: text,
    Voice: { VoiceId: useVoiceId },
    SdkAppId: TRTC_APP_ID,
    Model: 'flow_02_turbo',
    Language: 'zh',
    AudioFormat: { Format: 'mp3', SampleRate: 16000, Bitrate: 64 }
  }, 'ap-guangzhou', '2019-07-22').then(function (resp) {
    return resp.Audio || '';
  });
}

// ============================================================
// Basic TTS - tts.tencentcloudapi.com (TextToVoice)
// Cheaper for preset voices (0.3 yuan/10k chars vs 3 yuan for TRTC)
// Max 150 Chinese chars per request; long text is auto-split.
// ============================================================
function splitTextForTts(text, maxLen) {
  if (!text || text.length <= maxLen) return [text || ''];
  var chunks = [];
  var remaining = text;
  var punctuation = ['。', '！', '？', '；', '，', '、', ' ', '.', '!', '?', ';', ',', '\n'];
  while (remaining.length > maxLen) {
    var slice = remaining.slice(0, maxLen);
    var splitAt = -1;
    for (var i = slice.length - 1; i >= 0; i--) {
      if (punctuation.indexOf(slice[i]) !== -1) {
        splitAt = i + 1;
        break;
      }
    }
    if (splitAt <= 0) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

function doTtsBasic(text, voiceType, fastVoiceType) {
  if (!text) return Promise.reject(new Error('Missing text'));
  var chunks = splitTextForTts(text, 150);
  console.log('[TTS-basic] split into', chunks.length, 'chunk(s)');

  function synthChunk(chunkText, idx) {
    var payload = {
      Text: chunkText,
      SessionId: 'baba_why_' + Date.now() + '_' + idx,
      Volume: 5,
      Speed: 0,
      SampleRate: 16000,
      Codec: 'mp3'
    };
    if (fastVoiceType) {
      payload.VoiceType = 200000000;
      payload.FastVoiceType = fastVoiceType;
    } else {
      payload.VoiceType = voiceType || 101001;
    }
    return tencentRequest('tts', 'TextToVoice', payload, 'ap-guangzhou', '2019-08-23')
      .then(function (resp) {
        return Buffer.from(resp.Audio || '', 'base64');
      });
  }

  var result = Promise.resolve(Buffer.alloc(0));
  chunks.forEach(function (chunk, idx) {
    result = result.then(function (acc) {
      return synthChunk(chunk, idx).then(function (buf) {
        return Buffer.concat([acc, buf]);
      });
    });
  });
  return result.then(function (fullBuf) {
    return fullBuf.toString('base64');
  });
}

// ============================================================
// Voice Clone
// ============================================================
function doClone(voiceName, audio, promptText) {
  if (!TRTC_APP_ID) return Promise.reject(new Error('Missing TRTC_SDK_APP_ID env var'));
  if (!audio) return Promise.reject(new Error('Missing audio data'));
  if (!voiceName) return Promise.reject(new Error('Missing voice name'));

  var audioBuf = Buffer.from(audio, 'base64');
  var audioSizeKB = Math.round(audioBuf.length / 1024);
  console.log('[clone] audio size:', audioSizeKB, 'KB');

  // mp3 48kbps: ~6KB/s; 6 seconds ~36KB; less than 20KB means recording is too short
  if (audioBuf.length < 20 * 1024) {
    return Promise.reject(new Error('Recording too short, please record at least 10 seconds (15-30s recommended)'));
  }

  // VoiceName: only alphanumeric and underscore, max 36 chars
  var safeName = String(voiceName).replace(/[^a-zA-Z0-9_]/g, '_').slice(0, 36);
  console.log('[clone] SdkAppId=' + TRTC_APP_ID + ' VoiceName=' + safeName + ' audioLen=' + audio.length);

  return tencentRequest('trtc', 'VoiceClone', {
    SdkAppId: TRTC_APP_ID,
    VoiceName: safeName,
    PromptAudio: audio,
    PromptText: promptText || '',
    Model: 'flow_02_turbo'
  }, 'ap-guangzhou', '2019-07-22').then(function (resp) {
    console.log('[clone] VoiceId=' + resp.VoiceId + ' RequestId=' + resp.RequestId);
    if (!resp.VoiceId) {
      return Promise.reject(new Error('Empty VoiceId from Tencent Cloud'));
    }
    return resp.VoiceId;
  });
}

// ============================================================
// Translate Tencent error codes to user-friendly messages
// ============================================================
function friendlyError(err, context) {
  var code = (err && err.code) ? err.code : '';
  var msg = (err && err.message) ? err.message : String(err);
  var reqId = (err && err.requestId) ? err.requestId : '';
  console.error('[' + context + '] code=' + code + ' msg=' + msg + ' reqId=' + reqId);

  if (code === 'AuthFailure.SecretIdNotFound' || code === 'AuthFailure.SignatureFailure' || code === 'AuthFailure') {
    return new Error(context + ': Tencent Cloud key error, check TENCENT_SECRET_ID/SECRET_KEY');
  }
  if (code === 'InvalidParameter' || code === 'InvalidParameterValue') {
    return new Error(context + ': Invalid parameter - ' + msg);
  }
  if (code === 'FailedOperation' || code === 'InternalError') {
    return new Error(context + ': Tencent Cloud service error (' + code + '), please retry');
  }
  if (code === 'LimitExceeded') {
    return new Error(context + ': Quota exceeded, please retry later');
  }
  if (code === 'ResourceNotFound' || code === 'ResourceNotFound.SdkAppIdNotExist') {
    return new Error(context + ': TRTC SdkAppId not found, check TRTC_SDK_APP_ID');
  }
  if (code === 'UnauthorizedOperation') {
    return new Error(context + ': Service not activated, please enable TRTC VoiceClone in Tencent Cloud console');
  }
  return new Error(context + ': ' + msg);
}

// ============================================================
// Entry point
// ============================================================
exports.main = async function (event) {
  var t0 = Date.now();
  var action = event.voiceAction;
  console.log('[voice] action=' + action +
    ' hasSID=' + !!SECRET_ID +
    ' hasSKEY=' + !!SECRET_KEY +
    ' hasAPPID=' + !!TRTC_APP_ID);

  if (!SECRET_ID || !SECRET_KEY) {
    return { ok: false, error: 'TENCENT_SECRET_ID / TENCENT_SECRET_KEY not configured in cloud function env vars' };
  }

  try {
    if (action === 'asr') {
      console.log('[voice] ASR start');
      var text = await doAsr(event.audio);
      console.log('[voice] ASR done in ' + (Date.now() - t0) + 'ms, len=' + (text || '').length);
      return { ok: true, data: { text: text } };
    }

    if (action === 'tts') {
      var requestedVoice = event.voiceId || '';
      var isNumericVoice = /^\d+$/.test(requestedVoice);
      var useBasicEngine = !requestedVoice || isNumericVoice;
      console.log('[voice] TTS start voiceId=' + (requestedVoice || 'default') + ' engine=' + (useBasicEngine ? 'basic' : 'trtc'));

      var audio;
      if (useBasicEngine) {
        var voiceType = parseInt(requestedVoice, 10) || 101001;
        audio = await doTtsBasic(event.text, voiceType);
      } else {
        audio = await doTts(event.text, requestedVoice);
      }
      console.log('[voice] TTS done in ' + (Date.now() - t0) + 'ms, audioLen=' + (audio || '').length);
      return { ok: true, data: { audio: audio } };
    }

    if (action === 'clone') {
      console.log('[voice] clone start voiceName=' + event.voiceName + ' role=' + event.role);
      var voiceId = await doClone(event.voiceName, event.audio, event.promptText);
      console.log('[voice] clone done in ' + (Date.now() - t0) + 'ms, VoiceId=' + voiceId);
      return { ok: true, data: { voiceId: voiceId } };
    }

    return { ok: false, error: 'Unknown action: ' + action };
  } catch (err) {
    var friendly = friendlyError(err, action || 'voice');
    console.error('[voice] failed in ' + (Date.now() - t0) + 'ms: ' + friendly.message);
    return { ok: false, error: friendly.message };
  }
};
