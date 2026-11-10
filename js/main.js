import * as THREE from 'three';
import {TunnelTrack} from './track.js';
import {Genome,evolve} from './ai.js';
import {Drone} from './drone.js';

const $=id=>document.getElementById(id);
const viewport=$('viewport');
const scene=new THREE.Scene();scene.background=new THREE.Color(0x050914);scene.fog=new THREE.FogExp2(0x050914,.006);
const camera=new THREE.PerspectiveCamera(72,1,.1,700);
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
viewport.prepend(renderer.domElement);
scene.add(new THREE.HemisphereLight(0x8bbdff,0x101020,1.15));
const key=new THREE.PointLight(0x3bdfff,95,100);key.position.set(0,8,0);scene.add(key);
const track=new TunnelTrack(scene);
const clock=new THREE.Clock();
let population=[],drones=[],generation=1,running=false,paused=false,simSpeed=1,manualMode=false,cameraMode='chase',bestEver=0,bestGenome=null,history=[],selectedDrone=null,episodeTime=0;
const maxEpisode=42;
function makePopulation(n){population=Array.from({length:n},()=>new Genome());spawn();}
function spawn(){
  drones.forEach(d=>d.dispose());drones=population.map((g,i)=>new Drone(scene,i,g,track));selectedDrone=drones[0];episodeTime=0;
}
function start(){if(!running){running=true;paused=false;$('runStatus').textContent='EVOLUTION RUNNING';}else paused=false;updateButtons();}
function pause(){paused=!paused;$('runStatus').textContent=paused?'PAUSED':'EVOLUTION RUNNING';updateButtons();}
function reset(){running=false;paused=false;generation=1;bestEver=0;bestGenome=null;history=[];makePopulation(+$('population').value);$('runStatus').textContent='SIMULATION READY';updateButtons();renderStats();}
function updateButtons(){$('startBtn').textContent=running?'▶ Resume evolution':'▶ Start evolution';$('pauseBtn').textContent=paused?'▶ Resume':'Ⅱ Pause';}
function generationDone(){
  const ranked=[...population].sort((a,b)=>b.fitness-a.fitness),champ=ranked[0];
  if(champ&&champ.fitness>bestEver){bestEver=champ.fitness;bestGenome=champ.clone();}
  history.push(champ?.fitness||0);if(history.length>60)history.shift();
  population=evolve(population);generation++;spawn();renderStats();
}
function activeCount(){return drones.filter(d=>d.alive).length;}
function renderStats(){
  $('generation').textContent=generation;$('hudGen').textContent=generation;
  $('alive').textContent=activeCount();$('hudAlive').textContent=activeCount();
  const leader=[...drones].sort((a,b)=>b.progress-a.progress)[0];
  const best=leader||drones[0];const progress=best?best.progress:0;
  $('distance').innerHTML=(progress*270).toFixed(1)+'<span>m</span>';
  $('bestSpeed').innerHTML=(best?best.maxSpeed:0).toFixed(1)+'<span>m/s</span>';
  $('lapLabel').textContent='PROGRESS '+(progress*100).toFixed(1)+'%';
  const champ=[...population].sort((a,b)=>b.fitness-a.fitness)[0];
  $('champName').textContent=bestGenome?'Generation champion':'Awaiting flight data';
  $('champDetail').textContent=bestGenome?'Best genome saved in this session':'Start evolution to train';
  $('champFitness').textContent=champ?Math.round(champ.fitness):'—';
  drawChart();
}
function drawChart(){
  const c=$('fitnessChart'),ctx=c.getContext('2d'),w=c.width,h=c.height;ctx.clearRect(0,0,w,h);
  ctx.strokeStyle='#20314b';ctx.lineWidth=1;for(let i=1;i<4;i++){ctx.beginPath();ctx.moveTo(0,h*i/4);ctx.lineTo(w,h*i/4);ctx.stroke();}
  if(history.length<1)return;const max=Math.max(100,...history),min=Math.min(0,...history);
  const pts=history.map((v,i)=>[i/(Math.max(1,history.length-1))*w,h-((v-min)/(max-min||1))*(h-12)-6]);
  const grad=ctx.createLinearGradient(0,0,0,h);grad.addColorStop(0,'#38e5ef');grad.addColorStop(1,'#2365a5');
  ctx.beginPath();pts.forEach((p,i)=>i?ctx.lineTo(...p):ctx.moveTo(...p));ctx.strokeStyle=grad;ctx.lineWidth=3;ctx.stroke();
  ctx.lineTo(w,h);ctx.lineTo(0,h);ctx.closePath();ctx.fillStyle='#20cde51c';ctx.fill();
}
function updateCamera(dt){
  let target=selectedDrone;
  if(!manualMode&&drones.length){target=drones.reduce((a,b)=>b.progress>a.progress?b:a,drones[0]);selectedDrone=target;}
  if(!target)return;
  const pos=target.pos;
  if(cameraMode==='chase'){
    const forward=new THREE.Vector3(0,0,-1).applyEuler(new THREE.Euler(target.pitch,target.yaw,target.roll,'YXZ'));
    const desired=pos.clone().addScaledVector(forward,-9).add(new THREE.Vector3(0,4.2,0));
    camera.position.lerp(desired,1-Math.exp(-3.5*dt));
    camera.lookAt(pos.clone().addScaledVector(forward,5));
  }else{
    const forward=new THREE.Vector3(0,0,-1).applyEuler(new THREE.Euler(target.pitch,target.yaw,target.roll,'YXZ'));
    camera.position.copy(pos).add(new THREE.Vector3(0,.3,0));camera.lookAt(pos.clone().addScaledVector(forward,20));
  }
}
const manualDrone=new Drone(scene,999,new Genome(),track);manualDrone.group.visible=false;
function animate(){
  requestAnimationFrame(animate);const realDt=Math.min(clock.getDelta(),.04),dt=realDt*simSpeed;
  if(running&&!paused){
    if(manualMode){const keys=window.keys||{};const out=[(keys.ArrowUp?1:0)-(keys.ArrowDown?1:0),(keys.ArrowRight?1:0)-(keys.ArrowLeft?1:0),(keys.KeyD?1:0)-(keys.KeyA?1:0),(keys.KeyW?1:0)-(keys.KeyS?1:0)];manualDrone.step(dt,out);selectedDrone=manualDrone;if(!manualDrone.alive){manualDrone.alive=true;manualDrone.pos.copy(track.frameAt(0).p);manualDrone.vel.set(0,0,0);manualDrone.age=0;manualDrone.progress=0;}}
    else{
      episodeTime+=dt;
      for(const d of drones)if(d.alive)d.step(dt);
      if(activeCount()===0||episodeTime>maxEpisode)generationDone();
    }
    renderStats();
  }
  updateCamera(realDt);
  renderer.render(scene,camera);
}
window.keys={};window.addEventListener('keydown',e=>{window.keys[e.code]=true;if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code))e.preventDefault();});
window.addEventListener('keyup',e=>window.keys[e.code]=false);
function resize(){const w=viewport.clientWidth,h=viewport.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
new ResizeObserver(resize).observe(viewport);resize();
$('startBtn').onclick=start;$('pauseBtn').onclick=pause;$('resetBtn').onclick=reset;
$('speed').oninput=e=>{simSpeed=+e.target.value;$('speedVal').textContent=simSpeed.toFixed(1)+'×';$('hudSpeed').textContent=simSpeed.toFixed(1)+'×';};
$('population').onchange=()=>reset();
$('aiMode').onclick=()=>{manualMode=false;$('aiMode').classList.add('selected');$('manualMode').classList.remove('selected');$('manualHelp').textContent='AI Auto: the neural network controls each drone.';};
$('manualMode').onclick=()=>{manualMode=true;$('manualMode').classList.add('selected');$('aiMode').classList.remove('selected');$('manualHelp').textContent='Manual: ← / → roll · ↑ / ↓ pitch · W / S throttle · A / D yaw';manualDrone.alive=true;manualDrone.pos.copy(track.frameAt(0).p);manualDrone.vel.set(0,0,0);manualDrone.age=0;};
$('chaseBtn').onclick=()=>{cameraMode='chase';$('chaseBtn').classList.add('selected');$('cockpitBtn').classList.remove('selected');$('cameraLabel').textContent='CHASE CAMERA · LEADING DRONE';};
$('cockpitBtn').onclick=()=>{cameraMode='fpv';$('cockpitBtn').classList.add('selected');$('chaseBtn').classList.remove('selected');$('cameraLabel').textContent='FPV CAMERA · PILOT VIEW';};
makePopulation(+$('population').value);renderStats();animate();
setTimeout(()=>{$('loading').style.opacity='0';setTimeout(()=>$('loading').remove(),550);},700);
