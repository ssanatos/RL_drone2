// ai.js — 정책 네트워크(MLP) + 유전 알고리즘(신경진화). Three.js 의존 없음.
import { OBS_DIM, ACT_DIM, mulberry32 } from './sim.js';
export { mulberry32 };

export const HIDDEN = 16;
export const N_WEIGHTS = OBS_DIM * HIDDEN + HIDDEN + HIDDEN * ACT_DIM + ACT_DIM;

function gauss(rng) { let u = 0, v = 0; while (!u) u = rng(); while (!v) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

export class Genome {
  constructor(weights, rng = Math.random) {
    this.w = weights ? Float64Array.from(weights) : Float64Array.from({ length: N_WEIGHTS }, () => gauss(rng) * 0.5);
    this.fitness = 0; this.dist = 0; this.maxSpeed = 0; this.finished = false;
    this._h = new Float64Array(HIDDEN);
  }
  // obs(OBS_DIM) -> out(ACT_DIM) , tanh 출력 [-1,1]
  act(obs, out = new Array(ACT_DIM)) {
    const w = this.w, h = this._h;
    let k = 0;
    for (let j = 0; j < HIDDEN; j++) { let s = w[k++]; for (let i = 0; i < OBS_DIM; i++) s += w[k++] * obs[i]; h[j] = Math.tanh(s); }
    for (let o = 0; o < ACT_DIM; o++) { let s = w[k++]; for (let j = 0; j < HIDDEN; j++) s += w[k++] * h[j]; out[o] = Math.tanh(s); }
    return out;
  }
  clone() { return new Genome(this.w); }
  toJSON() { return { format: 'drone-ai-genome', version: 2, obs: OBS_DIM, hidden: HIDDEN, act: ACT_DIM, fitness: this.fitness, weights: Array.from(this.w) }; }
  static fromJSON(o) {
    if (!o || o.format !== 'drone-ai-genome') throw new Error('드론 챔피언 JSON 형식이 아닙니다.');
    if (o.obs !== OBS_DIM || o.hidden !== HIDDEN || o.act !== ACT_DIM || o.weights?.length !== N_WEIGHTS)
      throw new Error(`네트워크 구조가 다릅니다 (파일: ${o.obs}-${o.hidden}-${o.act}, 현재: ${OBS_DIM}-${HIDDEN}-${ACT_DIM}).`);
    const g = new Genome(o.weights); g.fitness = o.fitness || 0; return g;
  }
}

export function mutate(w, rate, sigma, rng) {
  for (let i = 0; i < w.length; i++) if (rng() < rate) w[i] += gauss(rng) * sigma;
}

// 한 개의 챔피언으로 개체군을 채운다(불러오기/이어서 학습용): 첫 개체는 원본, 나머지는 약한 변이
export function seedPopulation(genome, n, rng = Math.random, sigma = 0.1) {
  const pop = [genome.clone()];
  while (pop.length < n) { const c = genome.clone(); mutate(c.w, 0.2, sigma, rng); pop.push(c); }
  return pop;
}

export function evolve(pop, { rng = Math.random, eliteFrac = 0.06, poolFrac = 0.3, rate = 0.08, sigma = 0.25, immigrants = 0.05 } = {}) {
  const ranked = [...pop].sort((a, b) => b.fitness - a.fitness);
  const next = [];
  const nElite = Math.max(2, Math.floor(pop.length * eliteFrac));
  for (let i = 0; i < nElite; i++) next.push(ranked[i].clone());           // 엘리트 보존
  const pool = ranked.slice(0, Math.max(4, Math.ceil(pop.length * poolFrac)));
  const nFresh = Math.floor(pop.length * immigrants);
  const pick = () => { let b = null; for (let i = 0; i < 3; i++) { const x = pool[Math.floor(rng() * pool.length)]; if (!b || x.fitness > b.fitness) b = x; } return b; };
  while (next.length < pop.length - nFresh) {
    const a = pick(), b = pick(), c = a.clone();
    for (let i = 0; i < c.w.length; i++) if (rng() < 0.5) c.w[i] = b.w[i];   // 균등 교차
    mutate(c.w, rate, sigma, rng);                                              // 가우시안 변이
    next.push(c);
  }
  while (next.length < pop.length) next.push(new Genome(null, rng));          // 신규 무작위 개체(다양성 유지)
  return next;
}
