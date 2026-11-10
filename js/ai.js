// Compact feed-forward policy: 10 inputs -> 12 tanh units -> 4 controls.
export const INPUTS=10,HIDDEN=12,OUTPUTS=4;
export class Genome{
  constructor(weights){this.w=weights||Array.from({length:INPUTS*HIDDEN+HIDDEN+HIDDEN*OUTPUTS+OUTPUTS},()=>Math.random()*2-1);this.fitness=0;this.progress=0;this.maxSpeed=0;this.finished=false;}
  act(input){
    let k=0,h=[];
    for(let j=0;j<HIDDEN;j++){let s=this.w[k++];for(let i=0;i<INPUTS;i++)s+=this.w[k++]*input[i];h.push(Math.tanh(s));}
    const out=[];
    for(let o=0;o<OUTPUTS;o++){let s=this.w[k++];for(let j=0;j<HIDDEN;j++)s+=this.w[k++]*h[j];out.push(Math.tanh(s));}
    return out;
  }
  clone(){return new Genome(this.w.slice());}
}
export function evolve(pop){
  const ranked=[...pop].sort((a,b)=>b.fitness-a.fitness);
  const next=[];
  // Elitism: preserve top genomes unchanged.
  for(let i=0;i<Math.max(2,Math.floor(pop.length*.08));i++)next.push(ranked[i].clone());
  const pool=ranked.slice(0,Math.max(4,Math.ceil(pop.length*.35)));
  while(next.length<pop.length){
    const a=tournament(pool),b=tournament(pool),child=a.clone();
    for(let i=0;i<child.w.length;i++){
      if(Math.random()<.5)child.w[i]=b.w[i];
      if(Math.random()<.075)child.w[i]+=(Math.random()*2-1)*.45;
      if(Math.random()<.008)child.w[i]=Math.random()*2-1;
    }
    next.push(child);
  }
  return next;
}
function tournament(pool){let best=null;for(let i=0;i<3;i++){const x=pool[Math.floor(Math.random()*pool.length)];if(!best||x.fitness>best.fitness)best=x;}return best;}
