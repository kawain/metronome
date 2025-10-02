/**
 * js/main.js
 * Web Audio APIを使用したメトロノームとチューナー
 * ES Modules形式 (バニラJavaScript)
 */

// --- 1. 定数とグローバル変数 ---

// 音程と周波数のマッピング
const FREQUENCY_MAP = {
  C2: 65.406,
  'C#2': 69.296,
  Db2: 69.296,
  D2: 73.416,
  'D#2': 77.782,
  Eb2: 77.782,
  E2: 82.407,
  F2: 87.307,
  'F#2': 92.499,
  Gb2: 92.499,
  G2: 97.999,
  'G#2': 103.826,
  Ab2: 103.826,
  A2: 110,
  'A#2': 116.541,
  Bb2: 116.541,
  B2: 123.471,
  C3: 130.813,
  'C#3': 138.591,
  Db3: 138.591,
  D3: 146.832,
  'D#3': 155.563,
  Eb3: 155.563,
  E3: 164.814,
  F3: 174.614,
  'F#3': 184.997,
  Gb3: 184.997,
  G3: 195.998,
  'G#3': 207.652,
  Ab3: 207.652,
  A3: 220,
  'A#3': 233.082,
  Bb3: 233.082,
  B3: 246.942,
  C4: 261.626,
  'C#4': 277.183,
  Db4: 277.183,
  D4: 293.665,
  'D#4': 311.127,
  Eb4: 311.127,
  E4: 329.628,
  F4: 349.228,
  'F#4': 369.994,
  Gb4: 369.994,
  G4: 391.995,
  'G#4': 415.305,
  Ab4: 415.305,
  A4: 440,
  'A#4': 466.164,
  Bb4: 466.164,
  B4: 493.883,
  C5: 523.251,
  'C#5': 554.365,
  Db5: 554.365,
  D5: 587.33,
  'D#5': 622.254,
  Eb5: 622.254,
  E5: 659.255,
  F5: 698.456,
  'F#5': 739.989,
  Gb5: 739.989,
  G5: 783.991,
  'G#5': 830.609,
  Ab5: 830.609,
  A5: 880,
  'A#5': 932.328,
  Bb5: 932.328,
  B5: 987.767,
  C6: 1046.502
}

const C4_FREQUENCY = FREQUENCY_MAP.C4 // Guitar-C4.wavの基本周波数

// チューニング音程
const TUNING_NOTES = {
  regular: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'], // レギュラーチューニング
  halfDown: ['Eb2', 'Ab2', 'Db3', 'Gb3', 'Bb3', 'Eb4'] // ハーフダウンチューニング
}

// AudioContextとノード
let audioContext
let masterGainNode // 全体の音量制御用
let hiHatBuffer = null
let guitarBuffer = null
let buffersLoaded = false

// メトロノームの状態
let isRunning = false
let tempo = 120 // デフォルトBPM
let nextNoteTime = 0.0 // 次の拍が鳴るAudioContextの時刻
const lookahead = 25.0 // スケジュールチェックをミリ秒単位でどれだけ先読みするか (タイマー間隔)
const scheduleAheadTime = 0.1 // 拍のスケジュールを秒単位でどれだけ先に行うか
let intervalId = null // スケジューリング用のsetInterval ID

// --- 2. DOM要素の取得 ---
const startStopButton = document.getElementById('start-stop-button')
const tempoSlider = document.getElementById('tempo-slider')
const tempoDisplay = document.getElementById('tempo-display')
const volumeSlider = document.getElementById('volume-slider')
const volumeDisplay = document.getElementById('volume-display')
const regularTuningDiv = document.getElementById('regular-tuning')
const halfDownTuningDiv = document.getElementById('half-down-tuning')

// --- 3. AudioContextの初期化とロード ---

/**
 * AudioContextを初期化し、マスターゲインノードを設定する
 */
function initAudioContext () {
  if (audioContext) return
  // クロスブラウザ対応
  audioContext = new (window.AudioContext || window.webkitAudioContext)()

  // マスターゲインノードを設定
  masterGainNode = audioContext.createGain()
  masterGainNode.gain.value = volumeSlider.value / 100
  masterGainNode.connect(audioContext.destination)
}

/**
 * WAVファイルをフェッチし、デコードする
 * @param {string} url - ファイルのパス
 * @returns {Promise<AudioBuffer>} デコードされたAudioBuffer
 */
async function loadSound (url) {
  try {
    const response = await fetch(url)
    const arrayBuffer = await response.arrayBuffer()
    // decodeAudioDataはAudioContextを必要とするため、initAudioContext後に実行される
    return await audioContext.decodeAudioData(arrayBuffer)
  } catch (e) {
    console.error(`音源のロードまたはデコードに失敗しました: ${url}`, e)
    return null
  }
}

/**
 * すべての音源をロードする
 */
async function loadAllBuffers () {
  initAudioContext() // AudioContextを初期化

  // 音源のロードとデコードを並行して行う
  const [hiHat, guitar] = await Promise.all([
    loadSound('sound/Closed-Hi-Hat.wav'),
    loadSound('sound/Guitar-C4.wav')
  ])

  hiHatBuffer = hiHat
  guitarBuffer = guitar

  if (hiHatBuffer && guitarBuffer) {
    buffersLoaded = true
    startStopButton.textContent = '開始'
    startStopButton.disabled = false
  } else {
    startStopButton.textContent = 'ロード失敗'
    console.error('必要な音源の一部またはすべてがロードされませんでした。')
  }
}

// --- 4. メトロノーム機能 ---

/**
 * 指定された時間に音を鳴らす
 * @param {AudioBuffer} buffer - 再生するAudioBuffer
 * @param {number} time - AudioContextの時刻
 */
function playMetronomeSound (buffer, time) {
  const source = audioContext.createBufferSource()
  source.buffer = buffer
  source.connect(masterGainNode)
  // Web Audio APIの正確なタイミングで再生開始
  source.start(time)
}

/**
 * 次の拍をスケジュールする (正確なタイミング制御用)
 */
function scheduler () {
  // スケジュールAheadTime (先読み時間) までに鳴らすべき拍をすべてスケジュールする
  while (nextNoteTime < audioContext.currentTime + scheduleAheadTime) {
    // 次の拍の音をスケジュール
    playMetronomeSound(hiHatBuffer, nextNoteTime)

    // 拍間の秒数を計算 (60秒 / BPM)
    const secondsPerBeat = 60.0 / tempo

    // 次の拍の時間を更新
    nextNoteTime += secondsPerBeat
  }
}

/**
 * メトロノームの再生を開始
 */
function startMetronome () {
  if (!buffersLoaded) return

  // AudioContextがサスペンド状態なら再開 (ユーザー操作でアクティブにするため)
  if (audioContext.state === 'suspended') {
    audioContext
      .resume()
      .then(() => {
        console.log('AudioContext resumed for metronome.')
      })
      .catch(e => console.error('AudioContext resume failed:', e))
  }

  isRunning = true
  startStopButton.textContent = '停止'
  tempoSlider.disabled = true // 再生中はテンポ変更不可

  // 初期化: 現在の時刻からスケジュールを開始
  nextNoteTime = audioContext.currentTime

  // スケジューラを定期的に実行
  intervalId = setInterval(scheduler, lookahead)
}

/**
 * メトロノームの再生を停止
 */
function stopMetronome () {
  isRunning = false
  startStopButton.textContent = '開始'
  tempoSlider.disabled = false // 停止中はテンポ変更可能

  // スケジューラをクリア
  clearInterval(intervalId)
  intervalId = null
}

// --- 5. チューナー機能 ---

/**
 * チューナー音を再生する
 * @param {string} note - 音程名 (例: 'E2')
 */
function playTunerNote (note) {
  if (!buffersLoaded) return

  // AudioContextがサスペンド状態なら再開 (ユーザー操作でアクティブにするため)
  if (audioContext.state === 'suspended') {
    audioContext
      .resume()
      .then(() => {
        console.log('AudioContext resumed for tuner.')
        // resumeが完了してから音を再生
        _actuallyPlayTunerNote(note)
      })
      .catch(e => console.error('AudioContext resume failed:', e))
  } else {
    _actuallyPlayTunerNote(note)
  }
}

/**
 * playTunerNoteから呼ばれる内部関数
 * @param {string} note - 音程名 (例: 'E2')
 */
function _actuallyPlayTunerNote (note) {
  const targetFrequency = FREQUENCY_MAP[note]
  if (!targetFrequency) {
    console.error(`不明な音程: ${note}`)
    return
  }

  // 再生レートを計算: targetFrequency / C4_FREQUENCY
  const playbackRate = targetFrequency / C4_FREQUENCY

  const source = audioContext.createBufferSource()
  source.buffer = guitarBuffer

  // ピッチ変更のためplaybackRateを設定
  source.playbackRate.value = playbackRate

  source.connect(masterGainNode)
  source.start(0)

  // 3秒後に音源を停止し、ノードをクリーンアップ
  source.stop(audioContext.currentTime + 3.0)
  source.onended = () => {
    source.disconnect()
  }
}

// --- 6. イベントリスナーとUI制御 ---

/**
 * チューナーボタンを生成し、イベントリスナーを追加する
 */
function setupTunerButtons () {
  // レギュラーチューニングとハーフダウンチューニングのボタンを生成
  Object.keys(TUNING_NOTES).forEach(tuningKey => {
    const parentDiv =
      tuningKey === 'regular' ? regularTuningDiv : halfDownTuningDiv
    TUNING_NOTES[tuningKey].forEach(note => {
      const button = document.createElement('button')
      button.textContent = note
      button.classList.add('tuner-button')
      button.dataset.note = note
      // クリック時に音を再生
      button.addEventListener('click', () => {
        // 音源がロードされていない場合は何もしない
        if (!buffersLoaded) {
          console.warn('音源がまだロードされていません。')
          return
        }
        playTunerNote(note)
      })
      parentDiv.appendChild(button)
    })
  })
}

// メトロノーム開始/停止ボタンのイベントリスナー
startStopButton.addEventListener('click', () => {
  if (!buffersLoaded) return // ロード完了前は無効

  if (isRunning) {
    stopMetronome()
  } else {
    startMetronome()
  }
})

// テンポスライダーの変更イベントリスナー
tempoSlider.addEventListener('input', event => {
  tempo = parseInt(event.target.value, 10)
  tempoDisplay.textContent = tempo
})

// 音量スライダーの変更イベントリスナー (リアルタイム音量変更)
volumeSlider.addEventListener('input', event => {
  const volumeValue = parseInt(event.target.value, 10)
  // 0-100の値を0-10に変換して表示
  volumeDisplay.textContent = volumeValue / 10

  if (masterGainNode) {
    // 0-100の値を0-1.0のゲインに変換してmasterGainNodeに適用
    masterGainNode.gain.value = volumeValue / 100
  }
})

// --- 7. 初期化実行 ---
document.addEventListener('DOMContentLoaded', () => {
  setupTunerButtons()
  loadAllBuffers() // DOMContentLoaded時にすべての音源のロードを開始
})
