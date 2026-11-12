// 헤드리스 학습: 렌더링 없이 sim.js 만으로 빠르게 학습하고 챔피언을 JSON 으로 저장.
//   node tools/train.mjs --gens 100 --pop 120 --seed 1 --out champion.json
// 저장된 JSON 은 브라우저의 "Load" 버튼으로 불러와 CHAMPION 모드에서 재생할 수 있다.
import { writeFileSync } from 'node:fs';
import { Track, DroneEnv, mulberry32 } from '../js/sim.js';
import { Genome, evolve } from '../js/ai.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const GENS = +arg('gens', 60), POP = +arg('pop', 100), SEED = +arg('seed', 1), OUT = arg('out', 'champion.json');
const rng = mulberry32(SEED), track = new Track();
const act = new Array(4);
let pop = Array.from({ length: POP }, () => new Genome(null, rng));
const envs = pop.map(() => new DroneEnv(track, rng));
let best = null;
const t0 = Date.now();
for (let gen = 1; gen <= GENS; gen++) {
  pop.forEach((g, i) => {
    const e = envs[i]; e.reset();
    while (!e.done) e.step(g.act(e.obs, act));
    g.fitness = e.ret; g.dist = Math.max(0, e.s); g.finished = e.finished;
  });
  const ranked = [...pop].sort((a, b) => b.fitness - a.fitness), c = ranked[0];
  if (!best || c.fitness > best.fitness) best = c.clone(), best.fitness = c.fitness;
  const mean = pop.reduce((s, g) => s + g.fitness, 0) / POP, fin = pop.filter(g => g.finished).length;
  if (gen % 5 === 0 || gen === 1 || gen === GENS) console.log(`gen ${String(gen).padStart(3)}  best ${c.fitness.toFixed(1).padStart(7)}  dist ${c.dist.toFixed(0).padStart(3)}/${track.length.toFixed(0)}m  mean ${mean.toFixed(1).padStart(7)}  finished ${fin}/${POP}  (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  pop = evolve(pop, { rng });
}
writeFileSync(OUT, JSON.stringify(best));
console.log(`saved ${OUT} (fitness ${best.fitness.toFixed(1)})`);
