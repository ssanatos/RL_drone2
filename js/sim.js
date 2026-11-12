// sim.js — Three.js에 의존하지 않는 순수 시뮬레이션/강화학습 환경 코어.
// 브라우저(렌더링)와 Node(헤드리스 학습, tools/train.mjs)에서 똑같이 import 할 수 있다.
//
//   const env = new DroneEnv(new Track());
//   let obs = env.reset();
//   while (!env.done) { const r = env.step([pitch, roll, yaw, throttle]); /* r = 이번 스텝 보상 */ }
//
// 환경 규약(Gym 스타일):  관측 OBS_DIM=16, 행동 ACT_DIM=4 (각 [-1,1]), 고정 시간 간격 DT.

export const DT = 1 / 60;       // 물리 고정 스텝 (프레임 속도/시뮬 배속과 무관 → 결정적·재현 가능)
export const OBS_DIM = 16;
export const ACT_DIM = 4;       // [pitch, roll, yaw, throttle]
export const MAX_TIME = 45;     // 에피소드 최대 시간(초)

export const PHYS = {
  pitchRate: 1.65, rollRate: 1.9, yawRate: 1.35,   // 명령 = 각속도(rad/s)
  pitchMax: 0.72, rollMax: 0.82,
  baseAccel: 3, thrustAccel: 18, liftAccel: 5, hoverThrust: 0.45, gravity: 1.4,
  drag: 0.986,          // 1/60초당 속도 감쇠
  maxSpeed: 24,
  radius: 0.38,         // 벽 충돌 여유
};

export const REWARD = {
  progress: 1.0,        // 중심선을 따라 전진한 거리(m)당 보상
  centering: 0.5,       // 터널 중앙 근처일수록 초당 소량 보상
  crash: -10,
  finish: 100,          // 완주 보너스 + 남은 시간 보너스
  finishTime: 5,
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DEFAULT_CTRL = [
  [0, 0, 0], [0, 0, -24], [5, 2, -48], [13, 5, -70], [15, 10, -94], [5, 13, -118],
  [-8, 9, -143], [-13, 2, -168], [-5, -3, -193], [8, -1, -218], [13, 5, -242], [0, 8, -270],
];

// THREE.CatmullRomCurve3('catmullrom', tension) 과 같은 곡선
function splinePoint(pts, tension, t, out) {
  const l = pts.length;
  const p = (l - 1) * t;
  let i = Math.floor(p), w = p - i;
  if (i >= l - 1) { i = l - 2; w = 1; }
  for (let k = 0; k < 3; k++) {
    const x0 = i > 0 ? pts[i - 1][k] : 2 * pts[0][k] - pts[1][k];
    const x1 = pts[i][k], x2 = pts[i + 1][k];
    const x3 = i + 2 < l ? pts[i + 2][k] : 2 * pts[l - 1][k] - pts[l - 2][k];
    const t1 = tension * (x2 - x0), t2 = tension * (x3 - x1);
    const c2 = -3 * x1 + 3 * x2 - 2 * t1 - t2, c3 = 2 * x1 - 2 * x2 + t1 + t2;
    out[k] = x1 + t1 * w + c2 * w * w + c3 * w * w * w;
  }
}

export class Track {
  constructor({ half = 5, ctrl = DEFAULT_CTRL, tension = 0.45, spacing = 0.5 } = {}) {
    this.half = half;
    // 1) 곡선 파라미터 기준으로 촘촘히 샘플 → 누적 호 길이
    const M = 6000, dense = new Float64Array((M + 1) * 3), cum = new Float64Array(M + 1), tmp = [0, 0, 0];
    for (let k = 0; k <= M; k++) {
      splinePoint(ctrl, tension, k / M, tmp);
      dense.set(tmp, k * 3);
      if (k) cum[k] = cum[k - 1] + Math.hypot(dense[k * 3] - dense[k * 3 - 3], dense[k * 3 + 1] - dense[k * 3 - 2], dense[k * 3 + 2] - dense[k * 3 - 1]);
    }
    // 2) 호 길이 기준 등간격 재샘플 → progress 가 진짜 '미터'가 된다
    this.length = cum[M];
    const n = (this.n = Math.max(2, Math.round(this.length / spacing)) + 1);
    const ds = (this.ds = this.length / (n - 1));
    const P = (this.P = new Float64Array(n * 3));
    let k = 0;
    for (let i = 0; i < n; i++) {
      const target = i * ds;
      while (k < M - 1 && cum[k + 1] < target) k++;
      const w = (target - cum[k]) / (cum[k + 1] - cum[k] || 1);
      for (let a = 0; a < 3; a++) P[i * 3 + a] = dense[k * 3 + a] + (dense[(k + 1) * 3 + a] - dense[k * 3 + a]) * w;
    }
    // 3) 각 지점의 좌표계: tangent(진행), right(오른쪽), normal(위쪽)
    const T = (this.T = new Float64Array(n * 3)), R = (this.R = new Float64Array(n * 3)), U = (this.U = new Float64Array(n * 3));
    for (let i = 0; i < n; i++) {
      const a = Math.max(0, i - 1) * 3, b = Math.min(n - 1, i + 1) * 3;
      let tx = P[b] - P[a], ty = P[b + 1] - P[a + 1], tz = P[b + 2] - P[a + 2];
      const tl = Math.hypot(tx, ty, tz); tx /= tl; ty /= tl; tz /= tl;
      let rx = -tz, rz = tx; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;   // tangent × worldUp
      const i3 = i * 3;
      T[i3] = tx; T[i3 + 1] = ty; T[i3 + 2] = tz;
      R[i3] = rx; R[i3 + 1] = 0; R[i3 + 2] = rz;
      U[i3] = -rz * ty; U[i3 + 1] = rz * tx - rx * tz; U[i3 + 2] = rx * ty;             // right × tangent
    }
  }
  // 거리 s(m) 위치의 중심선 점 (양 끝 밖은 접선 방향으로 연장)
  pointAt(s, out) {
    const { P, T, n, ds, length } = this;
    if (s <= 0) { for (let a = 0; a < 3; a++) out[a] = P[a] + T[a] * s; return out; }
    if (s >= length) { const e = (n - 1) * 3; for (let a = 0; a < 3; a++) out[a] = P[e + a] + T[e + a] * (s - length); return out; }
    const f = s / ds, i = Math.floor(f), w = f - i;
    for (let a = 0; a < 3; a++) out[a] = P[i * 3 + a] + (P[(i + 1) * 3 + a] - P[i * 3 + a]) * w;
    return out;
  }
}

export class DroneEnv {
  constructor(track, rng = Math.random) {
    this.track = track; this.rng = rng;
    this.obs = new Float32Array(OBS_DIM);
    this._la = [0, 0, 0];
    this.reset();
  }

  reset() {
    const tr = this.track, rng = this.rng;
    const lx = (rng() - 0.5) * 2.4, ly = (rng() - 0.5) * 2.4;      // 시작 위치 무작위(일반화용)
    this.x = tr.P[0] + tr.R[0] * lx + tr.U[0] * ly - tr.T[0] * 1.5;
    this.y = tr.P[1] + tr.R[1] * lx + tr.U[1] * ly - tr.T[1] * 1.5;
    this.z = tr.P[2] + tr.R[2] * lx + tr.U[2] * ly - tr.T[2] * 1.5;
    this.vx = tr.T[0] * 3; this.vy = tr.T[1] * 3; this.vz = tr.T[2] * 3;
    this.yaw = Math.atan2(-tr.T[0], -tr.T[2]) + (rng() - 0.5) * 0.1;
    this.pitch = Math.asin(tr.T[1]); this.roll = 0;
    this.age = 0; this.idx = 0; this.ret = 0; this.maxSpeed = 0; this.speed = 3;
    this.done = false; this.finished = false; this.endReason = '';
    this._basis(); this._locate(); this.sPrev = this.s; this._observe();
    return this.obs;
  }

  // 오일러(YXZ) → 전방/우측/상방 벡터 (THREE.Euler 'YXZ' 와 동일한 회전)
  _basis() {
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch), cy = Math.cos(this.yaw), sy = Math.sin(this.yaw), cr = Math.cos(this.roll), sr = Math.sin(this.roll);
    this.fx = -cp * sy; this.fy = sp; this.fz = -cp * cy;
    this.rx = cr * cy + sr * sp * sy; this.ry = sr * cp; this.rz = -cr * sy + sr * sp * cy;
    this.ux = -sr * cy + cr * sp * sy; this.uy = cr * cp; this.uz = sr * sy + cr * sp * cy;
  }

  // 직전 위치 근처 구간만 탐색(전역 최근접 탐색은 터널이 꼬이면 엉뚱한 구간으로 점프할 수 있음)
  _locate() {
    const tr = this.track, P = tr.P, n = tr.n;
    const lo = Math.max(0, this.idx - 6), hi = Math.min(n - 1, this.idx + 14);
    let best = lo, bd = Infinity;
    for (let i = lo; i <= hi; i++) {
      const dx = this.x - P[i * 3], dy = this.y - P[i * 3 + 1], dz = this.z - P[i * 3 + 2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    this.idx = best;
    const b = best * 3, dx = this.x - P[b], dy = this.y - P[b + 1], dz = this.z - P[b + 2];
    this.s = best * tr.ds + dx * tr.T[b] + dy * tr.T[b + 1] + dz * tr.T[b + 2];  // 중심선 따라 간 거리(m)
    this.lx = dx * tr.R[b] + dy * tr.R[b + 1] + dz * tr.R[b + 2];                  // 터널 단면 좌표
    this.ly = dx * tr.U[b] + dy * tr.U[b + 1] + dz * tr.U[b + 2];
  }

  _observe() {
    const tr = this.track, o = this.obs, h = tr.half, b = this.idx * 3, la = this._la;
    const vT = this.vx * tr.T[b] + this.vy * tr.T[b + 1] + this.vz * tr.T[b + 2];
    const vR = this.vx * tr.R[b] + this.vy * tr.R[b + 1] + this.vz * tr.R[b + 2];
    const vU = this.vx * tr.U[b] + this.vy * tr.U[b + 1] + this.vz * tr.U[b + 2];
    o[0] = clamp(this.lx / h, -1.5, 1.5); o[1] = clamp(this.ly / h, -1.5, 1.5);          // 중앙에서 벗어난 정도
    o[2] = clamp(vT / 18, -1.5, 1.5); o[3] = clamp(vR / 12, -1.5, 1.5); o[4] = clamp(vU / 12, -1.5, 1.5);
    o[5] = this.fx * tr.R[b] + this.fy * tr.R[b + 1] + this.fz * tr.R[b + 2];             // 기수 방향(트랙 기준)
    o[6] = this.fx * tr.U[b] + this.fy * tr.U[b + 1] + this.fz * tr.U[b + 2];
    o[7] = this.ux * tr.R[b] + this.uy * tr.R[b + 1] + this.uz * tr.R[b + 2];             // 추력 방향 기울기
    o[8] = this.pitch / PHYS.pitchMax; o[9] = this.roll / PHYS.rollMax;                  // 자세(적분 상태)
    for (let k = 0; k < 2; k++) {                                                          // 전방 8m / 20m 지점 방향(기체 좌표)
      tr.pointAt(this.s + (k ? 20 : 8), la);
      const dx = la[0] - this.x, dy = la[1] - this.y, dz = la[2] - this.z, len = Math.hypot(dx, dy, dz) || 1;
      o[10 + k * 3] = (dx * this.rx + dy * this.ry + dz * this.rz) / len;
      o[11 + k * 3] = (dx * this.ux + dy * this.uy + dz * this.uz) / len;
      o[12 + k * 3] = (dx * this.fx + dy * this.fy + dz * this.fz) / len;
    }
  }

  // action: 길이 4 배열([-1,1]). 반환값 = 이번 스텝 보상. 결과는 this.obs / this.done / this.endReason 에 있다.
  step(a) {
    if (this.done) return 0;
    const P = PHYS, tr = this.track;
    this.age += DT;
    this.pitch = clamp(this.pitch + clamp(a[0], -1, 1) * P.pitchRate * DT, -P.pitchMax, P.pitchMax);
    this.roll = clamp(this.roll + clamp(a[1], -1, 1) * P.rollRate * DT, -P.rollMax, P.rollMax);
    this.yaw += clamp(a[2], -1, 1) * P.yawRate * DT;
    const thrust = (clamp(a[3], -1, 1) + 1) * 0.5;
    this._basis();
    const fw = P.baseAccel + thrust * P.thrustAccel, up = (thrust - P.hoverThrust) * P.liftAccel;
    this.vx += (this.fx * fw + this.ux * up) * DT;
    this.vy += (this.fy * fw + this.uy * up - P.gravity) * DT;
    this.vz += (this.fz * fw + this.uz * up) * DT;
    this.vx *= P.drag; this.vy *= P.drag; this.vz *= P.drag;
    let sp = Math.hypot(this.vx, this.vy, this.vz);
    if (sp > P.maxSpeed) { const k = P.maxSpeed / sp; this.vx *= k; this.vy *= k; this.vz *= k; sp = P.maxSpeed; }
    this.x += this.vx * DT; this.y += this.vy * DT; this.z += this.vz * DT;
    this.speed = sp; if (sp > this.maxSpeed) this.maxSpeed = sp;
    this._locate();

    const h = tr.half;
    let r = (this.s - this.sPrev) * REWARD.progress;
    this.sPrev = this.s;
    r += REWARD.centering * DT * (1 - Math.min(1, (this.lx * this.lx + this.ly * this.ly) / (2 * h * h)));

    if (this.s >= tr.length) {                                   // 결승선 통과
      this.finished = true; this.done = true; this.endReason = 'finish';
      r += REWARD.finish + REWARD.finishTime * Math.max(0, MAX_TIME - this.age);
    } else if (Math.abs(this.lx) > h - P.radius || Math.abs(this.ly) > h - P.radius || this.s < -3) {
      this.done = true; this.endReason = 'crash'; r += REWARD.crash;   // 벽 충돌 또는 뒤로 이탈
    } else if (this.age >= MAX_TIME) {
      this.done = true; this.endReason = 'timeout';
    } else if (this.age > 3 && sp < 0.5) {
      this.done = true; this.endReason = 'stall';
    }
    this.ret += r;
    this._observe();
    return r;
  }
}
