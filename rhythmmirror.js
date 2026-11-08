/* =====================================================================
 *  리듬미러 연습 화면  -  rhythmmirror.js
 * =====================================================================
 *
 *  이 파일은 무엇인가?
 *  -------------------
 *  rhythmmirror.html(화면 모양)과 같은 폴더에 두고 함께 쓰는 "동작" 파일입니다.
 *  HTML은 버튼, 그래프 칸 같은 "그릇"만 만들고, 이 파일이 그 그릇 안에
 *  글자와 그림을 채우고 버튼이 눌렸을 때 할 일을 정합니다.
 *
 *  전체 흐름 (한 줄 요약)
 *  ---------------------
 *  아두이노가 "패드를 쳤다"는 정보를 글자 한 줄로 보냄
 *    -> 이 파일이 줄을 읽어서 (언제 쳤는지 / 얼마나 세게 / 어디를 쳤는지) 계산
 *    -> 메트로놈 박자와 비교해서 "빠름/느림"을 판정하고 화면에 표시
 *
 *  아두이노와 주고받는 글자의 종류 (아두이노 코드와 똑같이 맞춘 약속)
 *  ----------------------------------------------------------------
 *    아두이노 -> 이 화면
 *      H,번호,타격시각ms,위값,오른쪽값,아래값,왼쪽값   "방금 한 번 쳤다"
 *      P,n,아두이노시각ms                              "시계 맞추기" 답장
 *      I,...  /  OK,...                                 상태 / 명령 처리 결과
 *    이 화면 -> 아두이노
 *      T,n   "지금 몇 시야?"    Z   기준점 다시 재기
 *      S숫자 문턱값 바꾸기       ?   상태 알려줘
 *
 *  용어 설명 (처음 보는 분을 위해)
 *  ------------------------------
 *   - 피크(peak)  : 한 번 칠 때 센서가 느낀 "가장 큰 값".
 *   - 비율(ratio) : 4개 센서의 피크를 합계로 나눈 값. 세게 쳐도 약하게 쳐도 위치가
 *                    같으면 비율이 비슷해서, 위치를 알아낼 때 이 값을 씁니다.
 *   - 보정(calibration) : 각 위치(중앙/위/오른쪽/아래/왼쪽)를 10번씩 쳐서
 *                    "그 위치를 치면 비율이 대략 이렇게 나온다"를 저장해 두는 것.
 *   - 틱(tick)    : 메트로놈이 소리를 내는 시각 하나하나.
 *   - ms          : 1000분의 1초.
 *
 *  파일의 구성 (A~H는 아래 구분선 제목과 같습니다)
 *  ------------------------------------------------
 *   0. 준비물 (도우미 함수, 상수, 상태 변수)
 *   A. 시리얼 연결      : 컴퓨터와 아두이노를 케이블/블루투스로 잇기
 *   B. 시계 맞추기      : 아두이노 시계와 이 화면 시계의 차이 알아내기
 *   C. 들어오는 줄 처리 : 아두이노가 보낸 글자 한 줄을 종류별로 나누기
 *   D. 메트로놈         : 정확한 시각에 소리 내기
 *   E. 타격 처리        : 세기 / 위치 / 박자 계산 (이 파일의 핵심)
 *   F. 화면 갱신        : 계산 결과를 글자와 그림으로 보여주기
 *   G. 데모 입력        : 아두이노 없이 마우스로 화면 시험하기
 *   H. 버튼 연결        : 버튼을 누르면 어떤 함수를 부를지 이어주기
 * ===================================================================== */

'use strict';   // 오타로 만든 변수를 오류로 알려 주는 엄격 모드 (실수를 빨리 찾게 해 줌)


/* =====================================================================
 *  0. 준비물
 * ===================================================================== */

/**
 * $('이름') : HTML에서 id="이름"인 칸을 찾아 주는 줄임말.
 * 예) $('bpm') 은 BPM을 적는 입력칸을 돌려준다.
 * 이 파일에서 화면의 칸을 만질 때마다 쓰므로 짧게 만들어 두었다.
 */
const $ = id => document.getElementById(id);

/**
 * store : 브라우저 안에 값을 저장했다가 불러오는 상자.
 *  - 위치 보정 결과와 "소리 지연 보정값"을 저장해 두면, 창을 껐다 켜도 다시 안 해도 된다.
 *  - 브라우저 설정에 따라 저장이 막힐 수 있어서 try/catch로 감쌌다.
 *    (실패해도 프로그램은 멈추지 않고, 단지 저장이 안 될 뿐이다.)
 */
const store = {
  get(key, fallback) {                       // 저장된 값을 꺼낸다. 없으면 fallback을 쓴다.
    try {
      const v = localStorage.getItem('rm_' + key);
      return v === null ? fallback : JSON.parse(v);
    } catch (e) {
      return fallback;
    }
  },
  set(key, value) {                          // 값을 저장한다.
    try {
      localStorage.setItem('rm_' + key, JSON.stringify(value));
    } catch (e) {
      // 저장 실패는 무시 
    }
  },
};

/* ---------------------------------------------------------------------
 *  상수 : 프로그램 중간에 바뀌지 않는 값들
 * --------------------------------------------------------------------- */

// 위치 구역의 이름표. 코드 안에서는 영어 이름을 쓰고, 화면에는 한글(ZNAME)로 보여 준다.
const ZONES = ['center', 'top', 'right', 'bottom', 'left'];
const ZNAME = { center: '중앙', top: '위', right: '오른쪽', bottom: '아래', left: '왼쪽' };

// 센서 4개가 패드 그림에서 있는 자리. [가로, 세로]이고 -1~1 범위.
// (가로: 오른쪽이 +, 세로: 아래쪽이 +, 화면 그림 좌표와 같은 방향)
// 순서는 아두이노 핀 순서와 같다:  A0=위, A1=오른쪽, A2=아래, A3=왼쪽
const SENSOR_POS = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/* ---------------------------------------------------------------------
 *  상태 변수 : 프로그램이 돌아가는 동안 계속 바뀌는 값들
 * --------------------------------------------------------------------- */

let audioOffset = store.get('audioOffset', 0);  // 이 컴퓨터의 소리 지연 보정값(ms). 따라치기 보정으로 구함.
let cal = store.get('cal', {});                 // 위치 보정 결과. 예) { top:[0.45,0.2,0.15,0.2], ... }
let hits = [];                                  // 지금까지 친 타격 기록 (맨 뒤가 가장 최근)
let calZone = null;                             // 지금 위치 보정 중인 구역 (보정 중이 아니면 null)
let calBuf = [];                                // 위치 보정 중 모아 둔 비율들 (10개 모이면 평균을 냄)
let acc = {};                                   // 정확도 표. acc[친곳][판별된곳] = 횟수
let lastHit = null;                             // 가장 최근 타격 (화면의 "최근 타격" 칸에 표시)


/* ---------------------------------------------------------------------
 *  로그 : 화면 맨 아래 "아두이노에서 오는 글자 보기"에 쌓아 두는 기록
 * --------------------------------------------------------------------- */
const logLines = [];
function log(text) {
  logLines.push(text);
  if (logLines.length > 150) logLines.shift();   // 너무 길어지지 않게 오래된 것부터 지운다
  $('log').textContent = logLines.join('\n');
}


/* =====================================================================
 *  A. 시리얼 연결 (Web Serial)
 *
 *  "시리얼 포트"는 컴퓨터가 아두이노와 글자를 주고받는 통로다.
 *  USB 케이블을 꽂으면 COM4 같은 포트가 생기고, 블루투스(HC-06)를 윈도우에 연결해도
 *  비슷한 포트가 생긴다. 크롬/엣지의 Web Serial 기능이 이 포트를 열어 준다.
 * ===================================================================== */

let port = null;          // 열린 포트
let reader = null;        // 포트에서 글자를 읽는 도구
let writer = null;        // 포트로 글자를 보내는 도구
let readClosed = null;    // (닫을 때 기다리기 위한 표시)
let writeClosed = null;   // (닫을 때 기다리기 위한 표시)
let rxBuf = '';           // 받은 글자를 "한 줄이 완성될 때까지" 잠깐 모아 두는 곳
let connected = false;    // 지금 아두이노와 연결되어 있는가?

/** [연결] 버튼을 눌렀을 때: 포트를 고르게 하고, 열고, 읽기/시계맞추기를 시작한다. */
async function connect() {
  if (!('serial' in navigator)) {            // 이 브라우저가 Web Serial을 지원하지 않으면
    $('noSerial').style.display = 'block';   // 안내 문구를 보여 주고 끝낸다
    return;
  }
  try {
    port = await navigator.serial.requestPort();               // 포트 선택 창을 띄운다
    await port.open({ baudRate: +$('baud').value });           // 속도(baud)를 맞춰 연다.
                                                               // 속도는 아두이노 코드와 같아야 한다 (USB 115200, 블루투스 9600)
    // 보내기: 글자(문자열)를 바이트로 바꿔서 포트에 흘려 보내는 파이프
    const enc = new TextEncoderStream();
    writeClosed = enc.readable.pipeTo(port.writable);
    writer = enc.writable.getWriter();
    // 읽기: 포트에서 온 바이트를 글자로 바꿔 주는 파이프
    const dec = new TextDecoderStream();
    readClosed = port.readable.pipeTo(dec.writable);
    reader = dec.readable.getReader();

    connected = true;
    rxBuf = '';
    resetSync();       // 이전 연결의 시계 정보를 지운다
    uiConn();          // 화면 위쪽 "연결됨" 표시 갱신
    log('연결됨');
    readLoop();        // 받는 일을 시작 (계속 돌아가며 끝나지 않음)
    syncLoop();        // 시계 맞추기를 시작 (계속 돌아가며 반복)
  } catch (e) {
    log('연결 실패: ' + e.message);
    $('devInfo').textContent = '연결 실패: ' + e.message;
  }
}

/** [연결 끊기]를 눌렀을 때: 읽기/보내기를 멈추고 포트를 닫는다. */
async function disconnect() {
  connected = false;
  try { await reader.cancel(); } catch (e) {}
  try { await readClosed; } catch (e) {}
  try { await writer.close(); } catch (e) {}
  try { await writeClosed; } catch (e) {}
  try { await port.close(); } catch (e) {}
  port = reader = writer = null;
  uiConn();
  log('연결 끊김');
}

/**
 * 아두이노가 보낸 글자를 계속 받는 반복 작업.
 * 글자는 조각조각 도착할 수 있어서, rxBuf에 이어 붙이다가 줄바꿈('\n')이 나오면
 * 그 앞까지를 "한 줄"로 잘라서 onLine()에 넘긴다.
 */
async function readLoop() {
  try {
    while (connected) {
      const { value, done } = await reader.read();   // 글자가 올 때까지 기다린다
      if (done) break;                               // 연결이 닫히면 끝
      rxBuf += value;
      let i;
      while ((i = rxBuf.indexOf('\n')) >= 0) {       // 줄바꿈이 있으면 한 줄이 완성된 것
        const line = rxBuf.slice(0, i).replace(/\r/g, '').trim();
        rxBuf = rxBuf.slice(i + 1);
        if (line) onLine(line);
      }
    }
  } catch (e) {
    log('읽기 오류: ' + e.message);
  }
  if (connected) {            // 예상치 못하게 끊겼다면 화면 표시를 "연결 안 됨"으로 바꾼다
    connected = false;
    uiConn();
  }
}

/** 아두이노에 글자 한 줄을 보낸다. (끝에 줄바꿈이 자동으로 붙는다) */
function send(text) {
  if (!connected || !writer) return;
  writer.write(text + '\n').catch(e => log('보내기 오류: ' + e.message));
}


/* =====================================================================
 *  B. 시계 맞추기
 *
 *  왜 필요한가?
 *    아두이노는 "전원을 켠 뒤 몇 ms 지났는지"를, 이 화면(브라우저)은 "페이지를 연 뒤 몇 ms
 *    지났는지"를 센다. 둘은 서로 다른 시계라서 아두이노가 "5,000ms에 쳤다"고 해도
 *    이 화면의 시계로는 언제인지 모른다. 그래서 두 시계의 차이(offset)를 알아내야 한다.
 *
 *  어떻게 알아내나? (핑퐁 방식)
 *    1) 화면이 자기 시각 t0에 "T,번호"를 보낸다.
 *    2) 아두이노가 받자마자 자기 시각 a를 담아 "P,번호,a"로 답한다.
 *    3) 화면이 그 답을 자기 시각 t1에 받는다.
 *    4) 왕복 시간의 절반쯤 걸려 아두이노가 답했다고 보면,
 *         아두이노가 답한 순간 = 화면 시계로 (t0+t1)/2
 *         차이(offset) = a - (t0+t1)/2
 *    왕복이 짧았던 측정일수록 오차가 작으므로(최대 왕복시간의 절반), 최근 몇 번 중
 *    "가장 빨랐던 왕복"의 값을 쓴다. 또 아두이노 시계가 조금씩 어긋나기 때문에
 *    연결된 동안 계속 반복해서 갱신한다.
 * ===================================================================== */

const pending = new Map();   // 보냈지만 아직 답이 안 온 요청들 {번호: 보낸 시각}
let pingSeq = 1;             // 요청 번호 (1, 2, 3, ...)
let samples = [];            // 지금까지의 측정 결과들 {rtt:왕복시간, off:차이, at:측정시각}
let clockOffset = null;      // 최종 결과: 아두이노시각 - 화면시각 (아직 모르면 null)
let clockBest = null;        // 그 결과를 얻은 측정의 왕복시간 (오차 범위 계산에 씀)

/** 시계 정보를 모두 지우고 처음부터 시작한다. (새로 연결할 때) */
function resetSync() {
  pending.clear();
  samples = [];
  clockOffset = null;
  clockBest = null;
}

/** 연결된 동안 계속 "T,번호"를 보내는 반복 작업. */
async function syncLoop() {
  while (connected) {
    const n = pingSeq++;
    pending.set(n, performance.now());   // performance.now() : 이 화면의 정밀한 ms 시계
    send('T,' + n);
    // 3초가 넘도록 답이 없는 요청은 버린다 (메모리가 쌓이지 않게)
    const cut = performance.now() - 3000;
    for (const [k, v] of pending) if (v < cut) pending.delete(k);
    // 연결 직후엔 아두이노가 다시 시작하는 중이라 답이 늦으므로 0.25초마다 빠르게,
    // 6번 이상 답을 받아 안정되면 0.7초마다 느긋하게 반복한다.
    await new Promise(r => setTimeout(r, samples.length < 6 ? 250 : 700));
  }
}

/** "P,번호,아두이노시각" 답장이 왔을 때: 차이를 계산해서 갱신한다. */
function onSync(parts) {
  const n = +parts[1];          // 요청 번호
  const a = +parts[2];          // 아두이노가 답한 순간의 아두이노 시각
  const t0 = pending.get(n);    // 그 요청을 보냈던 화면 시각
  if (t0 === undefined || !isFinite(a)) return;   // 모르는 번호거나 이상한 값이면 무시
  pending.delete(n);
  const t1 = performance.now(); // 지금(답을 받은) 화면 시각

  samples.push({ rtt: t1 - t0, off: a - (t0 + t1) / 2, at: t1 });
  if (samples.length > 20) samples.shift();

  // 최근 4초 안의 측정 중 "왕복이 가장 짧았던 것"을 골라 쓴다.
  const recent = samples.filter(s => t1 - s.at < 4000);
  const pool = recent.length ? recent : samples;
  const best = pool.reduce((m, s) => (s.rtt < m.rtt ? s : m), pool[0]);
  clockOffset = best.off;
  clockBest = best.rtt;
  uiConn();   // 화면 위의 "시계: ±n ms" 표시 갱신
}


/* =====================================================================
 *  C. 들어오는 줄 처리
 *
 *  아두이노가 보낸 한 줄을 쉼표(,)로 잘라서 맨 앞 글자로 종류를 구분한다.
 *     "H,3,52340,512,301,120,88"  ->  ['H','3','52340','512','301','120','88']
 * ===================================================================== */
function onLine(line) {
  log(line);                         // 일단 기록해 둔다 (화면 맨 아래에서 볼 수 있음)
  const p = line.split(',');

  if (p[0] === 'P' && p.length >= 3) {
    onSync(p);                       // 시계 맞추기 답장

  } else if (p[0] === 'H' && p.length >= 7) {
    // 타격 한 번. 형식: H,번호,타격시각,위,오른쪽,아래,왼쪽
    const v = p.slice(1).map(Number);          // 글자를 숫자로 바꾼다
    if (v.every(isFinite)) {                   // 하나라도 숫자가 아니면(깨진 줄) 무시
      const hitMs = v[1];                      // 아두이노 시계로 친 시각
      // 아두이노 시각 -> 이 화면의 시각으로 바꾼다. 시계를 아직 못 맞췄으면 null.
      const pageT = clockOffset === null ? null : hitMs - clockOffset;
      addHit(pageT, v.slice(2, 6));            // 4개 센서의 피크 값 [위,오른쪽,아래,왼쪽]
    }

  } else if (p[0] === 'I' && p.length >= 7) {
    // 상태 보고. 형식: I,문턱값,BPM,기준점 4개
    $('devInfo').textContent = `문턱 ${p[1]} · 기준점 ${p.slice(3, 7).join('/')}`;
    $('thr').value = p[1];

  } else if (p[0] === 'OK') {
    $('devInfo').textContent = '명령 처리됨: ' + line;
  }
  // 그 밖의 줄(아두이노의 설명용 글자 등)은 기록만 하고 무시한다.
}


/* =====================================================================
 *  D. 메트로놈 (Web Audio)
 *
 *  왜 setInterval로 "딱" 소리를 내지 않나?
 *    브라우저의 타이머는 몇 ms ~ 수십 ms씩 흔들린다. 박자 연습에서는 치명적이다.
 *    그래서 Web Audio의 "소리 예약" 기능을 쓴다. 오디오 시계는 매우 정확해서
 *    "이 시각에 소리를 내라"고 미리 예약해 두면 정확히 그 시각에 난다.
 *    우리는 25ms마다 "앞으로 0.2초 안에 올 소리"를 미리 예약해 둔다.
 * ===================================================================== */

let actx = null;   // 오디오 장치 (처음 시작할 때 만든다)

// 메트로놈 상태를 한곳에 모아 둔 객체
const M = {
  running: false,   // 지금 메트로놈이 돌고 있나
  calib: false,     // 지금 "따라치기 보정" 중인가 (true면 판정 대신 지연값을 측정)
  startCtx: 0,      // 첫 소리를 낼 오디오 시계 시각(초)
  grid: 0.6,        // 소리 사이 간격(초). 60 / BPM / (채점 간격 나눔 수)
  subdiv: 1,        // 1=4분음표마다 채점, 2=8분음표마다 채점
  countIn: 4,       // 처음 몇 번의 소리까지 채점하지 않을지 (4박 * subdiv)
  next: 0,          // 다음에 예약할 소리의 번호 (0, 1, 2, ...)
  timer: null,      // 예약 작업을 25ms마다 부르는 타이머
  bpm: 100,
  calErrs: [],      // 소리 지연 보정 중 모은 오차들
};

/** 오디오 장치를 준비한다. 브라우저는 사용자가 버튼을 누른 뒤에야 소리를 허용한다. */
function ensureAudio() {
  if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
  if (actx.state === 'suspended') actx.resume();
}

/**
 * 오디오 시계와 화면 시계를 이어주는 값.
 *  오디오 시계(초)에 1000을 곱해 ms로 만든 뒤 이 값을 더하면 performance.now() 기준의 시각이 된다.
 *  getOutputTimestamp()는 "그 소리가 실제로 스피커에서 나오는 시각"을 알려 주는 기능이다.
 *  지원하지 않는 브라우저에서는 대략적인 값(출력 지연 포함)으로 대신한다.
 */
function ctxBase() {
  try {
    const ts = actx.getOutputTimestamp();
    if (ts && ts.performanceTime > 0 && ts.contextTime > 0) {
      return ts.performanceTime - ts.contextTime * 1000;
    }
  } catch (e) {}
  return performance.now() - actx.currentTime * 1000 + (actx.outputLatency || actx.baseLatency || 0) * 1000;
}

/**
 * i번째 소리가 울리는 시각을 "화면 시계(ms)"로 알려 준다. (판정할 때 쓴다)
 * 소리 지연 보정값(audioOffset)이 있으면 더해서 "사람이 실제로 들은 시각"으로 맞춘다.
 * 단, 지연 보정을 측정하는 중(M.calib)에는 0으로 두고 재야 하므로 더하지 않는다.
 */
function tickPage(i) {
  return ctxBase() + (M.startCtx + i * M.grid) * 1000 + (M.calib ? 0 : audioOffset);
}

/** 메트로놈을 시작한다. bpm: 박자 속도, subdiv: 채점 간격, calib: 보정 모드인가 */
function startMetronome(bpm, subdiv, calib) {
  ensureAudio();
  stopMetronome();                           // 이미 돌고 있으면 먼저 끈다
  M.bpm = bpm;
  M.subdiv = subdiv;
  M.grid = 60 / bpm / subdiv;                // 예) 120BPM, 4분음표 -> 0.5초 간격
  M.countIn = 4 * subdiv;                    // 처음 4박은 채점하지 않는다
  M.startCtx = actx.currentTime + 0.6;       // 0.6초 뒤에 첫 소리 (준비할 시간)
  M.next = 0;
  M.running = true;
  M.calib = !!calib;
  M.calErrs = [];
  M.timer = setInterval(schedule, 25);       // 25ms마다 "앞으로 올 소리"를 예약
  schedule();
  uiMetro();
}

/** 메트로놈을 멈춘다. */
function stopMetronome() {
  if (M.timer) clearInterval(M.timer);
  M.timer = null;
  M.running = false;
  M.calib = false;
  uiMetro();
}

/** 앞으로 0.2초 안에 올 소리를 모두 미리 예약한다. (25ms마다 불린다) */
function schedule() {
  while (M.startCtx + M.next * M.grid < actx.currentTime + 0.2) {
    playTick(M.next, M.startCtx + M.next * M.grid);
    M.next++;
  }
}

/**
 * i번째 소리를 오디오 시각 t(초)에 울리도록 예약한다.
 *  - 첫 박(4박마다 한 번): 높은 소리(강세)
 *  - 나머지 박: 중간 소리
 *  - 8분음표 모드의 사이 소리: 낮고 작은 소리
 */
function playTick(i, t) {
  const onBeat = i % M.subdiv === 0;           // 정박(큰 박)인가
  const beatNo = Math.floor(i / M.subdiv);     // 몇 번째 박인가 (0부터)
  const accent = onBeat && beatNo % 4 === 0;   // 마디의 첫 박인가 (4/4박자)
  const freq = accent ? 1568 : onBeat ? 1046 : 784;   // 소리 높이(Hz)
  const vol = onBeat ? 0.5 : 0.2;                      // 소리 크기

  const osc = actx.createOscillator();   // 소리를 만드는 장치 (네모파)
  const gain = actx.createGain();        // 소리 크기를 조절하는 장치
  osc.frequency.value = freq;
  osc.type = 'square';
  gain.gain.setValueAtTime(vol, t);
  gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);   // 0.05초 동안 점점 작아짐 ("딱" 소리)
  osc.connect(gain).connect(actx.destination);               // 소리 -> 크기 조절 -> 스피커
  osc.start(t);
  osc.stop(t + 0.06);

  if (onBeat) {
    // 화면의 박 표시 점도 소리와 같은 순간에 깜박이게 한다
    const delay = Math.max(0, (t - actx.currentTime) * 1000);
    setTimeout(() => flashBeat(beatNo % 4, accent, i < M.countIn), delay);
  }
}

/** 박 표시 점(●●●●) 중 k번째를 잠깐 켰다 끈다. 안내 문구도 갱신한다. */
function flashBeat(k, accent, countIn) {
  const dots = $('beats').children;
  for (const d of dots) d.className = '';
  dots[k].className = accent ? 'a' : 'f';    // 'a': 강세(주황), 'f': 일반(초록)
  if (M.running) {
    $('metroMsg').textContent = countIn
      ? '카운트인 (채점 안 함)'
      : (M.calib ? '소리에 맞춰 패드를 치세요 (보정 중)' : '소리에 맞춰 치세요');
  }
  setTimeout(() => { dots[k].className = ''; }, 120);   // 0.12초 뒤에 끈다
}


/* =====================================================================
 *  E. 타격 처리: 세기 / 위치 / 박자   (이 파일의 핵심)
 * ===================================================================== */

/**
 * 4개 센서 피크를 "비율"로 바꾼다. (합이 1이 되게)
 * 예) [200, 600, 200, 100] -> 합 1100 -> [0.18, 0.55, 0.18, 0.09]
 * 세게 치면 모든 숫자가 같이 커지지만 비율은 그대로여서, 세기와 상관없이 위치만 남는다.
 */
function sensorRatio(peaks) {
  const s = peaks.reduce((a, b) => a + b, 0);
  return s > 0 ? peaks.map(v => v / s) : [0.25, 0.25, 0.25, 0.25];
}

/**
 * 비율로 간단한 위치 추정값을 만든다.
 *  x = 오른쪽 - 왼쪽   (양수면 오른쪽에 치우침)
 *  y = 위 - 아래       (양수면 위쪽에 치우침)
 * 비율 순서는 [위, 오른쪽, 아래, 왼쪽] 이므로 p[1]이 오른쪽, p[3]이 왼쪽, p[0]이 위, p[2]가 아래.
 */
function xy(p) {
  return { x: p[1] - p[3], y: p[0] - p[2] };
}

/** 두 비율 묶음이 얼마나 다른지 (차이를 제곱해서 더한 값). 작을수록 닮았다. */
function dist2(a, b) {
  return a.reduce((s, v, i) => s + (v - b[i]) * (v - b[i]), 0);
}

/** 5곳 위치 보정이 모두 끝났는가? */
function calReady() {
  return ZONES.every(z => Array.isArray(cal[z]));
}

/**
 * ★ 위치 판별 (어느 구역을 쳤나)
 *  - 5곳 보정이 끝났으면: 저장해 둔 5개 기준 비율 중 "지금 비율과 가장 닮은 것"을 고른다.
 *    (예: 오른쪽 기준 비율과의 차이가 가장 작으면 "오른쪽")
 *  - 보정 전이면: 임시로 "가장 큰 센서 쪽"이라고 판단한다. 한 센서가 38% 미만이면 중앙.
 */
function classify(p) {
  if (calReady()) {
    let best = 'center';
    let bestDist = Infinity;
    for (const z of ZONES) {
      const d = dist2(p, cal[z]);
      if (d < bestDist) {
        bestDist = d;
        best = z;
      }
    }
    return best;
  }
  let m = 0;                                          // 가장 큰 센서의 번호 찾기
  for (let i = 1; i < 4; i++) if (p[i] > p[m]) m = i;
  return p[m] < 0.38 ? 'center' : ['top', 'right', 'bottom', 'left'][m];
}

/**
 * 패드 그림 위에 점을 찍을 위치 (-1 ~ 1). 중앙이 (0,0), 오른쪽 끝이 x=1, 위쪽 끝이 y=1.
 *  - 보정이 끝났으면: 보정한 "중앙/오른쪽/왼쪽/위/아래" 값으로 눈금을 맞춰서 계산한다.
 *  - 보정 전이면: 대략적인 눈금(0.5)으로 계산한다.
 */
function normPos(p) {
  const e = xy(p);
  let nx, ny;
  if (calReady()) {
    const c = xy(cal.center);                      // 중앙을 쳤을 때의 값 (기준점)
    const r = xy(cal.right).x - c.x;               // 오른쪽 끝까지의 눈금 폭
    const l = c.x - xy(cal.left).x;                // 왼쪽 끝까지의 눈금 폭
    const t = xy(cal.top).y - c.y;                 // 위쪽 끝까지의 눈금 폭
    const b = c.y - xy(cal.bottom).y;              // 아래쪽 끝까지의 눈금 폭
    nx = (e.x - c.x) / ((e.x >= c.x ? r : l) || 0.3);   // (|| 0.3 : 0으로 나누는 사고 방지)
    ny = (e.y - c.y) / ((e.y >= c.y ? t : b) || 0.3);
  } else {
    nx = e.x / 0.5;
    ny = e.y / 0.5;
  }
  const clamp = v => Math.max(-1, Math.min(1, v));   // -1~1 밖으로 나가지 않게 자른다
  return { x: clamp(nx), y: clamp(ny) };
}

/**
 * ★ 타격 한 번을 처리하는 가장 중요한 함수.
 *  아두이노에서 H 줄이 오거나 데모 입력이 들어올 때마다 불린다.
 *
 *  pageT : 친 시각 (이 화면 시계 기준, ms). 시계를 못 맞췄으면 null.
 *  peaks : 4개 센서의 피크 값 [위, 오른쪽, 아래, 왼쪽]
 *
 *  하는 일 순서:
 *   1) 세기와 위치를 계산해서 타격 기록(h)을 만든다.
 *   2) 메트로놈이 돌고 있으면 가장 가까운 박과의 시간 차이(오차)를 계산한다.
 *   3) 위치 보정 중이면 값을 모아서 평균을 낸다.
 *   4) 정확도 측정 중이면 결과를 표에 센다.
 *   5) 화면을 갱신한다.
 */
function addHit(pageT, peaks) {
  const sum = peaks.reduce((a, b) => a + b, 0);       // 4개 피크의 합 = "세기"
  if (sum <= 0) return;                                // 아무 신호도 없으면 버린다
  const p = sensorRatio(peaks);

  // 타격 기록 한 건을 만든다 (그래프와 CSV가 이 정보를 쓴다)
  const h = {
    n: hits.length + 1,    // 몇 번째 타격인가
    pageT,                 // 친 시각 (화면 시계)
    peaks,                 // 센서별 피크
    sum,                   // 피크 합계 (세기)
    p,                     // 센서별 비율
    zone: classify(p),     // 판별한 구역
    pos: normPos(p),       // 패드 그림에서의 점 위치
    tick: null,            // 가장 가까운 메트로놈 소리의 번호
    err: null,             // 박자 오차(ms). 음수=빠름, 양수=느림
    scored: false,         // 채점 대상인가 (카운트인은 false)
    target: null,          // 정확도 측정 때 "사용자가 지정한 정답 위치"
  };

  // --- 세기: 최근 8번의 평균 대비 몇 % 다른지 (일정하게 치는지 보기 위함) ---
  const prev = hits.slice(-8);
  h.dev = prev.length
    ? (sum / (prev.reduce((a, b) => a + b.sum, 0) / prev.length) - 1) * 100
    : null;

  // --- 박자: 메트로놈이 돌고 있고 시계도 맞춰져 있을 때만 계산 ---
  if (M.running && pageT !== null) {
    const gapMs = M.grid * 1000;              // 소리 사이 간격(ms)
    const t0 = tickPage(0);                   // 첫 소리의 시각
    const i = Math.round((pageT - t0) / gapMs);   // 가장 가까운 소리의 번호
    if (i >= 0) {                              // 시작 전에 친 것(i<0)은 제외
      h.tick = i;
      h.err = pageT - tickPage(i);            // 친 시각 - 소리 시각 = 오차(ms)
      h.scored = i >= M.countIn;              // 카운트인 구간이 아니면 채점
      // 소리 지연 보정 중이면 오차를 모았다가, 12개가 모이면 중앙값으로 보정값을 정한다
      if (M.calib && h.scored) {
        M.calErrs.push(h.err);
        $('metroMsg').textContent = `보정 중 ${M.calErrs.length}/12`;
        if (M.calErrs.length >= 12) finishAudioCalib();
      }
    }
  }

  // --- 위치 보정 모으기: 선택한 구역을 10번 치면 비율의 평균을 저장한다 ---
  if (calZone) {
    calBuf.push(p);
    $('calMsg').textContent = `${ZNAME[calZone]} ${calBuf.length}/10`;
    if (calBuf.length >= 10) {
      // 10개 비율의 평균 (센서 4개 각각의 평균)
      cal[calZone] = [0, 1, 2, 3].map(k => calBuf.reduce((a, q) => a + q[k], 0) / calBuf.length);
      store.set('cal', cal);                  // 브라우저에 저장 (다음에 열어도 남음)
      $('calMsg').textContent = `${ZNAME[calZone]} 보정 저장됨` + (calReady() ? ' · 5곳 모두 완료' : '');
      calZone = null;
      calBuf = [];
      renderCal();
    }
  }

  // --- 정확도 측정: "지금 치는 곳"으로 지정한 위치와 판별 결과를 표에 센다 ---
  if ($('accOn').checked && !calZone && !M.calib) {
    const target = $('accTarget').value;
    h.target = target;
    acc[target] = acc[target] || {};
    acc[target][h.zone] = (acc[target][h.zone] || 0) + 1;
    renderAcc();
  }

  hits.push(h);
  lastHit = h;
  renderHit();   // "최근 타격" 칸 갱신
  drawAll();     // 패드 그림과 그래프 갱신
}

/** 숫자 목록의 중앙값 (크기순으로 늘어놓았을 때 가운데 값). 튀는 값에 덜 흔들려서 평균 대신 쓴다. */
function median(arr) {
  const s = arr.slice().sort((x, y) => x - y);
  const m = s.length >> 1;                             // 가운데 번호
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * 소리 지연 보정을 마친다.
 *  12번 따라 친 오차의 중앙값이 "이 컴퓨터에서 소리를 듣고 치는 데 걸리는 평균 시간"이다.
 *  이 값을 저장해 두고, 이후 판정에서는 소리 시각에 이 값을 더해서 비교한다.
 */
function finishAudioCalib() {
  audioOffset = Math.round(median(M.calErrs));
  store.set('audioOffset', audioOffset);
  stopMetronome();
  $('metroMsg').textContent =
    `보정 완료: 이 컴퓨터는 소리보다 ${audioOffset >= 0 ? '+' : ''}${audioOffset}ms에 칩니다. 이후 판정에서 이 값을 뺍니다.`;
  uiMetro();
}


/* =====================================================================
 *  F. 화면 갱신
 *  (계산은 끝났고, 결과를 글자와 그림으로 보여 주는 부분)
 * ===================================================================== */

/** 화면 위쪽의 "연결됨 / 시계: ±n ms" 표시와, 연결 여부에 따른 버튼 켜기/끄기. */
function uiConn() {
  $('chipConn').textContent = connected ? '연결됨' : '연결 안 됨';
  $('chipConn').className = 'chip' + (connected ? ' on' : '');

  const ready = connected && clockOffset !== null;     // 시계 맞추기가 끝났는가
  $('chipSync').textContent = !connected
    ? '시계: -'
    : ready ? `시계: ±${(clockBest / 2).toFixed(0)} ms` : '시계 맞추는 중…';
  // 왕복이 80ms를 넘으면 오차가 크다는 뜻이라 주황색 경고로 보여 준다
  $('chipSync').className = 'chip' + (ready ? (clockBest > 80 ? ' warn' : ' on') : '');

  $('btnConnect').textContent = connected ? '연결 끊기' : '연결';
  $('btnConnect').className = connected ? 'stop' : 'primary';
  for (const id of ['btnZ', 'btnThr', 'btnQ', 'btnSend']) $(id).disabled = !connected;
  $('baud').disabled = connected;                      // 연결 중에는 속도를 못 바꾸게
}

/** 메트로놈 카드의 버튼 글자(시작/정지)와 "소리 지연 보정" 표시 갱신. */
function uiMetro() {
  $('btnStart').textContent = M.running && !M.calib ? '정지' : '시작';
  $('btnStart').className = M.running && !M.calib ? 'stop' : 'primary';
  $('btnCalibAudio').disabled = M.running && !M.calib;
  $('chipOff').textContent = `소리 지연 보정: ${audioOffset >= 0 ? '+' : ''}${audioOffset} ms`;
  if (!M.running) for (const d of $('beats').children) d.className = '';
}

/** "3. 최근 타격" 칸: 박자 오차, 세기 막대, 위치, 센서 비율을 보여 준다. */
function renderHit() {
  const h = lastHit;
  if (!h) return;
  const tol = +$('tol').value;                         // 허용 오차(ms)

  if (h.scored) {
    const e = Math.round(h.err);
    const a = Math.abs(e);
    $('bigErr').textContent = (e > 0 ? '+' : '') + e + ' ms';
    // 초록: 허용 오차 안 / 주황: 빠름 / 파랑: 느림
    $('bigErr').className = 'big ' + (a <= tol ? 'okc' : e < 0 ? 'early' : 'late');
    $('errLabel').textContent = a <= tol ? '정확합니다' : e < 0 ? '박자보다 빨랐습니다' : '박자보다 느렸습니다';
  } else {
    $('bigErr').textContent = h.err === null ? '–' : '카운트인';
    $('bigErr').className = 'big';
    $('errLabel').textContent = h.err === null
      ? (M.running ? '시계를 맞추는 중이거나 시작 전의 타격' : '메트로놈이 꺼져 있습니다')
      : '채점 전';
  }

  // 세기 막대: 합계 / "가득 찬 눈금" 값 (최대 100%)
  const pct = Math.min(100, h.sum / +$('full').value * 100);
  $('strBar').style.width = pct.toFixed(0) + '%';
  $('strText').textContent = `${pct.toFixed(0)}%` +
    (h.dev === null ? '' : ` (평소 대비 ${h.dev >= 0 ? '+' : ''}${h.dev.toFixed(0)}%)`);

  $('posText').textContent = ZNAME[h.zone] + (calReady() ? '' : ' (보정 전 추정)');
  $('ratioText').textContent = '센서 비율  위 ' + h.p.map(v => (v * 100).toFixed(0)).join(' / ') +
    '  (위/오른쪽/아래/왼쪽 %)';
  // 센서 하나라도 "포화 경고 기준" 이상이면 그 값은 최대치에 붙어서 비율이 틀어졌을 수 있다
  if (Math.max(...h.peaks) >= +$('sat').value) {
    $('ratioText').textContent += '  ⚠ 포화 가능: 이 타격은 위치 판별에 쓰지 마세요';
  }
}

/* ---------------------------------------------------------------------
 *  그림 그리기 (canvas)
 * --------------------------------------------------------------------- */

/**
 * 캔버스(그림판)를 그릴 준비를 한다.
 *  화면 해상도(레티나 등)에 맞춰 크기를 키워서 글자와 선이 선명하게 보이게 한다.
 *  처음 가로세로 비율은 dataset.r에 기억해 두고, 다시 그릴 때마다 그 비율을 유지한다.
 *  돌려주는 값: g(그리기 도구), w/h(화면 위 크기)
 */
function setup(canvas) {
  if (!canvas.dataset.r) canvas.dataset.r = canvas.height / canvas.width;
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 300;
  const h = w * canvas.dataset.r;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { g, w, h };
}

/** CSS 색 변수(--acc 등)의 실제 색을 읽어 온다. (밝은/어두운 모드에 맞는 색을 쓰려고) */
const css = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** "4. 타점" 그림: 원형 패드, 센서 4개, 최근 타격 점들을 그린다. */
function drawPad() {
  const c = $('pad');
  const { g, w, h } = setup(c);
  g.clearRect(0, 0, w, h);

  const cx = w / 2, cy = h / 2;            // 중심
  const R = Math.min(w, h) / 2 - 22;       // 패드 반지름

  // 패드 원과 가운데 십자선
  g.strokeStyle = css('--line');
  g.fillStyle = css('--bg');
  g.lineWidth = 2;
  g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill(); g.stroke();
  g.setLineDash([4, 4]);
  g.beginPath();
  g.moveTo(cx - R, cy); g.lineTo(cx + R, cy);
  g.moveTo(cx, cy - R); g.lineTo(cx, cy + R);
  g.stroke();
  g.setLineDash([]);

  // 센서 4개: 패드 가장자리에 점, 안쪽에 이름
  g.font = '12px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const names = ['위 A0', '오른쪽 A1', '아래 A2', '왼쪽 A3'];
  SENSOR_POS.forEach((s, i) => {
    g.fillStyle = css('--acc');
    g.beginPath(); g.arc(cx + s[0] * R, cy + s[1] * R, 7, 0, Math.PI * 2); g.fill();
    g.fillStyle = css('--mute');
    g.fillText(names[i], cx + s[0] * (R - 34), cy + s[1] * (R - 18));
  });

  // 최근 15번의 타격 점. 오래될수록 흐리게, 가장 최근 것은 크고 주황색 링으로 표시
  const recent = hits.slice(-15);
  recent.forEach((hit, i) => {
    const last = i === recent.length - 1;
    const px = cx + hit.pos.x * R * 0.85;
    const py = cy - hit.pos.y * R * 0.85;    // 화면 y는 아래가 +라서 부호를 뒤집는다
    g.globalAlpha = last ? 1 : 0.25 + 0.5 * (i / recent.length);
    g.fillStyle = last ? css('--early') : css('--acc');
    g.beginPath(); g.arc(px, py, last ? 9 : 5, 0, Math.PI * 2); g.fill();
    if (last) {
      g.globalAlpha = 1;
      g.strokeStyle = css('--early');
      g.lineWidth = 2;
      g.beginPath(); g.arc(px, py, 14, 0, Math.PI * 2); g.stroke();
    }
  });
  g.globalAlpha = 1;

  $('padHint').textContent = connected
    ? (calReady() ? '' : '위치 보정을 하면 더 정확해집니다')
    : '연결 전에는 패드를 클릭하면 데모 타격이 들어갑니다';
}

/**
 * 막대그래프를 그리는 공통 함수 (박자 그래프와 세기 그래프가 같이 쓴다).
 *  canvas : 그릴 캔버스
 *  vals   : 막대로 그릴 값들 (최근 20개까지)
 *  opts   : { min, max : 세로축 범위, base : 막대가 시작하는 기준값(0선),
 *             ticks : 눈금, unit : 눈금 단위 글자, band : 허용 오차 띠(±값),
 *             color(v) : 값에 따른 막대 색, avg : 평균선 위치 }
 */
function drawBars(canvas, vals, opts) {
  const { g, w, h } = setup(canvas);
  g.clearRect(0, 0, w, h);

  const L = 36, B = 14, T = 8;               // 왼쪽/아래/위 여백
  const pw = w - L - 6, ph = h - T - B;      // 그래프 영역 크기
  g.font = '11px sans-serif';
  g.textBaseline = 'middle';
  g.textAlign = 'right';
  // 값 -> 세로 위치(픽셀) 변환
  const y = v => T + ph * (1 - (v - opts.min) / (opts.max - opts.min));

  // 허용 오차 띠 (박자 그래프에서 ±허용값 범위를 연한 초록으로 칠함)
  if (opts.band) {
    g.fillStyle = css('--accsoft');
    g.fillRect(L, y(opts.band), pw, y(-opts.band) - y(opts.band));
  }
  // 가로 눈금선과 눈금 글자
  g.strokeStyle = css('--line');
  g.fillStyle = css('--mute');
  for (const t of opts.ticks) {
    g.beginPath(); g.moveTo(L, y(t)); g.lineTo(L + pw, y(t)); g.stroke();
    g.fillText(t + (opts.unit || ''), L - 4, y(t));
  }
  // 막대들 (최근 것이 오른쪽 끝에 오도록 20칸 중 뒤쪽부터 채운다)
  const n = 20, bw = pw / n;
  vals.forEach((v, i) => {
    if (v === null) return;
    const x = L + (n - vals.length + i) * bw;
    g.fillStyle = opts.color(v);
    const y0 = y(opts.base);
    const y1 = y(Math.max(opts.min, Math.min(opts.max, v)));
    g.fillRect(x + 2, Math.min(y0, y1), bw - 4, Math.max(2, Math.abs(y1 - y0)));
  });
  // 평균선 (점선)
  if (opts.avg !== undefined) {
    g.strokeStyle = css('--mute');
    g.setLineDash([4, 3]);
    g.beginPath(); g.moveTo(L, y(opts.avg)); g.lineTo(L + pw, y(opts.avg)); g.stroke();
    g.setLineDash([]);
  }
}

/** 박자 그래프, 세기 그래프, 그리고 박자 통계(평균/흔들림/허용 안 비율)를 그린다. */
function drawCharts() {
  const tol = +$('tol').value;

  // 박자 그래프: 채점된 타격의 오차 최근 20개. 허용 안=초록, 빠름=주황, 느림=파랑
  const scored = hits.filter(h => h.scored).slice(-20);
  drawBars($('chErr'), scored.map(h => h.err), {
    min: -150, max: 150, base: 0, ticks: [-100, 0, 100], unit: '', band: tol,
    color: v => Math.abs(v) <= tol ? css('--ok') : v < 0 ? css('--early') : css('--late'),
  });

  // 세기 그래프: 최근 20번의 세기(%) 와 그 평균선
  const full = +$('full').value;
  const strengths = hits.slice(-20).map(h => Math.min(100, h.sum / full * 100));
  const avg = strengths.length ? strengths.reduce((a, b) => a + b, 0) / strengths.length : undefined;
  drawBars($('chStr'), strengths, {
    min: 0, max: 100, base: 0, ticks: [0, 50, 100], unit: '%', color: () => css('--acc'), avg,
  });

  // 박자 통계
  if (scored.length) {
    const errs = scored.map(h => h.err);
    const mean = errs.reduce((a, b) => a + b, 0) / errs.length;              // 평균 오차: 항상 빠르면 -, 늦으면 +
    const sd = Math.sqrt(errs.reduce((a, b) => a + (b - mean) * (b - mean), 0) / errs.length);  // 표준편차: 들쭉날쭉한 정도
    $('stMean').textContent = (mean >= 0 ? '+' : '') + mean.toFixed(0) + ' ms';
    $('stSd').textContent = '±' + sd.toFixed(0) + ' ms';
    $('stOk').textContent = (errs.filter(v => Math.abs(v) <= tol).length / errs.length * 100).toFixed(0) + '%';
  } else {
    $('stMean').textContent = $('stSd').textContent = $('stOk').textContent = '-';
  }
}

/** 패드 그림과 그래프를 한꺼번에 다시 그린다. */
function drawAll() {
  drawPad();
  drawCharts();
}

/* ---------------------------------------------------------------------
 *  위치 보정 / 정확도 칸
 * --------------------------------------------------------------------- */

/** "7. 위치 보정" 칸: 구역 버튼 5개를 만든다. 보정이 끝난 구역에는 ✓ 표시. */
function renderCal() {
  const box = $('calBtns');
  box.innerHTML = '';
  for (const z of ZONES) {
    const b = document.createElement('button');
    b.textContent = ZNAME[z] + (Array.isArray(cal[z]) ? ' ✓' : '');
    b.onclick = () => {                                  // 이 버튼을 누르면 그 구역 보정을 시작
      calZone = z;
      calBuf = [];
      $('calMsg').textContent = `${ZNAME[z]}을(를) 10번 치세요 (0/10)`;
    };
    box.appendChild(b);
  }
  if (!calZone && !$('calMsg').textContent) {
    $('calMsg').textContent = calReady() ? '5곳 모두 보정되어 있습니다.' : '아직 보정 전입니다. 처음엔 중앙부터.';
  }
}

/**
 * "8. 위치 정확도 측정" 표를 그린다.
 *  가로: 판별된 위치, 세로: 실제로 친 위치. 대각선(초록 칸)이 "맞춘 횟수"다.
 *  맨 아래 줄에 전체 정확도(맞춘 수 / 전체 수)를 보여 준다.
 */
function renderAcc() {
  let html = '<tr><th>치는 곳 \\ 판별</th>' + ZONES.map(z => `<th>${ZNAME[z]}</th>`).join('') + '<th>정확도</th></tr>';
  let total = 0, correct = 0;
  for (const target of ZONES) {
    const row = acc[target] || {};
    const n = ZONES.reduce((a, z) => a + (row[z] || 0), 0);     // 이 위치를 친 총 횟수
    if (!n && !acc[target]) {                                    // 아직 안 친 위치: 0으로 채운 줄
      html += `<tr><th>${ZNAME[target]}</th>${ZONES.map(() => '<td>0</td>').join('')}<td>-</td></tr>`;
      continue;
    }
    total += n;
    correct += row[target] || 0;
    html += `<tr><th>${ZNAME[target]}</th>` +
      ZONES.map(z => `<td class="${z === target ? 'diag' : ''}">${row[z] || 0}</td>`).join('') +
      `<td>${n ? ((row[target] || 0) / n * 100).toFixed(0) + '%' : '-'}</td></tr>`;
  }
  $('accTable').innerHTML = html;
  $('accText').textContent = total
    ? `전체 ${correct}/${total} = ${(correct / total * 100).toFixed(0)}%`
    : '측정을 켜고 한 곳을 정해 여러 번 치세요.';
}


/* =====================================================================
 *  G. 데모 입력 (아두이노 없이 화면을 시험하는 기능)
 *
 *  패드 그림을 클릭하거나 스페이스바를 누르면 "가짜 타격"이 들어간다.
 *  센서 값은 "센서에서 멀수록 작아지는" 간단한 식으로 만든다.
 *  아두이노가 연결된 동안에는 진짜 데이터가 섞이지 않도록 데모를 받지 않는다.
 * ===================================================================== */

/** 평균 0 근처의 무작위 수 (센서 값에 살짝 흔들림을 주려고 씀) */
function randn() {
  return (Math.random() + Math.random() + Math.random() - 1.5) / 0.5;
}

/** (x, y) 위치를 쳤다고 가정한 가짜 타격을 만든다. x, y는 -1~1 (패드 중심이 0,0). */
function demoHit(x, y) {
  if (connected) return;                         // 아두이노 연결 중이면 무시
  const strength = 300 + Math.random() * 700;   // 임의의 세기
  const peaks = SENSOR_POS.map(s => {
    const distance = Math.hypot(x - s[0], y - s[1]);                 // 센서까지의 거리
    const value = strength * Math.exp(-distance / 0.9) * (1 + 0.08 * randn());   // 멀수록 작게 + 약간의 흔들림
    return Math.max(1, Math.round(value));
  });
  addHit(performance.now(), peaks);              // 친 시각은 "지금"
}

// 패드 그림을 클릭하면 그 위치를 친 것으로 한다
$('pad').addEventListener('click', ev => {
  const r = $('pad').getBoundingClientRect();
  const R = (Math.min(r.width, r.height) / 2 - 22) * 0.85;   // drawPad()가 점을 찍는 반지름과 같게 맞춘다
  demoHit((ev.clientX - r.left - r.width / 2) / R, (ev.clientY - r.top - r.height / 2) / R);
});

// 스페이스바 = 중앙 타격 (입력칸이나 버튼에 글자를 쓰는 중에는 무시)
document.addEventListener('keydown', ev => {
  if (ev.code === 'Space' && !/INPUT|SELECT|TEXTAREA|BUTTON/.test(document.activeElement.tagName)) {
    ev.preventDefault();
    demoHit(0, 0);
  }
});


/* =====================================================================
 *  H. 버튼 연결 : "이 버튼을 누르면 이 함수를 실행" 이라고 이어 주는 부분
 * ===================================================================== */

$('btnConnect').onclick = () => (connected ? disconnect() : connect());

// [기준점 다시 재기]: 아두이노에 Z 명령. 패드를 건드리지 않은 상태에서 눌러야 한다.
$('btnZ').onclick = () => {
  send('Z');
  $('devInfo').textContent = '기준점을 다시 재는 중… 패드를 건드리지 마세요';
};
// [적용]: 문턱값 입력칸의 숫자를 아두이노에 S숫자로 보낸다. 예) S20
$('btnThr').onclick = () => send('S' + (+$('thr').value));
// [상태 확인]: ? 명령
$('btnQ').onclick = () => send('?');
// 아래쪽 명령 입력칸: 쓰고 [보내기] 또는 엔터
$('btnSend').onclick = () => {
  const v = $('cmd').value.trim();
  if (v) {
    send(v);
    log('> ' + v);
    $('cmd').value = '';
  }
};
$('cmd').addEventListener('keydown', ev => { if (ev.key === 'Enter') $('btnSend').click(); });

// [시작/정지]
$('btnStart').onclick = () => {
  if (M.running && !M.calib) {
    stopMetronome();
  } else {
    const bpm = Math.max(40, Math.min(200, +$('bpm').value || 100));   // 40~200으로 제한
    startMetronome(bpm, +$('subdiv').value, false);
  }
};

// [따라치기 보정]: 80BPM으로 12번 따라 치게 해서 소리 지연을 잰다
$('btnCalibAudio').onclick = () => {
  if (M.calib) {            // 보정 중에 다시 누르면 취소
    stopMetronome();
    return;
  }
  $('bpm').value = 80;
  startMetronome(80, 1, true);
  $('metroMsg').textContent = '카운트인 후 12번을 소리에 맞춰 치세요';
};

// [보정 초기화]: 저장된 위치 보정을 모두 지운다
$('btnCalReset').onclick = () => {
  cal = {};
  store.set('cal', cal);
  calZone = null;
  calBuf = [];
  $('calMsg').textContent = '';
  renderCal();
  drawAll();
};

// 정확도 표 초기화 / 기록 지우기
$('btnAccReset').onclick = () => { acc = {}; renderAcc(); };
$('btnClear').onclick = () => {
  hits = [];
  lastHit = null;
  $('bigErr').textContent = '-';
  $('bigErr').className = 'big';
  drawAll();
};

// [CSV로 저장]: 타격 기록을 표 파일로 내려받는다. (엑셀에서 한글이 안 깨지도록 맨 앞에 BOM 문자를 붙임)
$('btnCsv').onclick = () => {
  const rows = ['번호,기록시각ms,박번호,오차ms,위,오른쪽,아래,왼쪽,합계,판별위치,정답위치'];
  for (const h of hits) {
    rows.push([
      h.n,
      h.pageT === null ? '' : h.pageT.toFixed(1),
      h.tick ?? '',
      h.err === null ? '' : h.err.toFixed(1),
      ...h.peaks,
      h.sum,
      ZNAME[h.zone],
      h.target ? ZNAME[h.target] : '',
    ].join(','));
  }
  const url = URL.createObjectURL(new Blob(['' + rows.join('\n')], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = 'rhythmmirror_hits.csv';
  a.click();
  URL.revokeObjectURL(url);
};

// 허용 오차나 "가득 찬 눈금"을 바꾸면 바로 다시 그린다
for (const id of ['tol', 'full']) {
  $(id).addEventListener('change', () => { renderHit(); drawCharts(); });
}


/* =====================================================================
 *  시작: 페이지를 열면 맨 처음 한 번 실행되는 부분
 * ===================================================================== */
$('accTarget').innerHTML = ZONES.map(z => `<option value="${z}">${ZNAME[z]}</option>`).join('');
if (!('serial' in navigator)) $('noSerial').style.display = 'block';   // 지원 안 하는 브라우저면 안내 문구
renderCal();
renderAcc();
uiConn();
uiMetro();
drawAll();
window.addEventListener('resize', drawAll);   // 창 크기가 바뀌면 그림을 다시 그린다

// 개발/시험용: 브라우저 콘솔에서 내부 값을 들여다보기 위한 창구. 평소 동작에는 영향 없음.
window.__rm = {
  M,
  tickPage,
  get clockOffset() { return clockOffset; },
  get hits() { return hits; },
  get cal() { return cal; },
  get audioOffset() { return audioOffset; },
};
