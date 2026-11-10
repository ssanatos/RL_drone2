import * as THREE from 'three';
import {Genome} from './ai.js';

const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export class Drone{
  constructor(scene,id,genome,track){
    this.id=id;this.genome=genome;this.track=track;this.alive=true;this.finished=false;this.age=0;this.progress=0;this.maxSpeed=0;this.speed=0;
    this.pos=track.frameAt(0).p.clone().add(new THREE.Vector3((Math.random()-.5)*1.2,(Math.random()-.5)*1.2,1.5));
    this.vel=new THREE.Vector3();this.yaw=0;this.pitch=0;this.roll=0;
    this.group=new THREE.Group();scene.add(this.group);
    const body=new THREE.Mesh(new THREE.BoxGeometry(.72,.22,.95),new THREE.MeshStandardMaterial({color:new THREE.Color().setHSL((id*.137)%1,.8,.58),metalness:.55,roughness:.28,emissive:0x06202a}));
    this.group.add(body);
    const armMat=new THREE.MeshStandardMaterial({color:0x9db5ce,metalness:.7,roughness:.25});
    for(const sx of [-1,1])for(const sz of [-1,1]){
      const arm=new THREE.Mesh(new THREE.CylinderGeometry(.045,.045,.72,8),armMat);arm.rotation.z=Math.PI/2;arm.position.set(sx*.46,.03,sz*.34);this.group.add(arm);
      const prop=new THREE.Mesh(new THREE.CylinderGeometry(.2,.2,.025,16),new THREE.MeshBasicMaterial({color:0x43e7f5,transparent:true,opacity:.7}));prop.position.set(sx*.72,.12,sz*.52);this.group.add(prop);
    }
    const nose=new THREE.Mesh(new THREE.ConeGeometry(.16,.36,8),new THREE.MeshBasicMaterial({color:0xefffff}));nose.rotation.x=Math.PI/2;nose.position.z=-.58;this.group.add(nose);
    this.light=new THREE.PointLight(0x36eaff,1.3,5);this.group.add(this.light);this.group.visible=id<160;
    this.updateVisual();
  }
  sensorInputs(){
    const n=this.track.nearest(this.pos),f=n.frame,l=this.track.local(this.pos,f);
    const half=this.track.half;
    const toTarget=this.track.frameAt(Math.min(.999,n.t+.035)).p.clone().sub(this.pos).normalize();
    const forward=new THREE.Vector3(0,0,-1).applyEuler(new THREE.Euler(this.pitch,this.yaw,this.roll,'YXZ')).normalize();
    const right=new THREE.Vector3(1,0,0).applyEuler(new THREE.Euler(this.pitch,this.yaw,this.roll,'YXZ')).normalize();
    const up=new THREE.Vector3(0,1,0).applyEuler(new THREE.Euler(this.pitch,this.yaw,this.roll,'YXZ')).normalize();
    return [
      clamp((half-l.x)/half,-1,1),clamp((half+l.x)/half,-1,1),
      clamp((half-l.y)/half,-1,1),clamp((half+l.y)/half,-1,1),
      clamp(l.z/12,-1,1),
      clamp(this.vel.dot(f.tangent)/18,-1,1),
      clamp(this.vel.dot(f.right)/12,-1,1),
      clamp(this.vel.dot(f.normal)/12,-1,1),
      clamp(toTarget.dot(forward),-1,1),
      clamp(toTarget.dot(right),-1,1)
    ];
  }
  step(dt,manual=null){
    if(!this.alive)return;
    this.age+=dt;
    const input=this.sensorInputs();
    const out=manual||this.genome.act(input);
    const [pitchCmd,rollCmd,yawCmd,throttleCmd]=out;
    // Attitude has inertia; controls command angular rates, not instant position changes.
    this.pitch=clamp(this.pitch+pitchCmd*1.65*dt,-.72,.72);
    this.roll=clamp(this.roll+rollCmd*1.9*dt,-.82,.82);
    this.yaw+=yawCmd*1.35*dt;
    const orientation=new THREE.Euler(this.pitch,this.yaw,this.roll,'YXZ');
    const forward=new THREE.Vector3(0,0,-1).applyEuler(orientation);
    const right=new THREE.Vector3(1,0,0).applyEuler(orientation);
    const up=new THREE.Vector3(0,1,0).applyEuler(orientation);
    const thrust=(throttleCmd+1)*.5;
    const accel=forward.multiplyScalar(3+thrust*18).addScaledVector(up,(thrust-.45)*5).add(new THREE.Vector3(0,-1.4,0));
    this.vel.addScaledVector(accel,dt);
    // Air drag and speed cap keep the simplified quadcopter stable.
    this.vel.multiplyScalar(Math.pow(.986,dt*60));
    const sp=this.vel.length();if(sp>24)this.vel.multiplyScalar(24/sp);
    this.pos.addScaledVector(this.vel,dt);this.speed=this.vel.length();this.maxSpeed=Math.max(this.maxSpeed,this.speed);
    const hit=this.track.collision(this.pos);this.progress=Math.max(this.progress,hit.progress);
    if(hit.hit||this.age>42||this.speed<.15&&this.age>3)this.alive=false;
    if(hit.progress>=.995){this.finished=true;this.alive=false;}
    this.updateVisual();
    // Fitness rewards forward progress, speed and completion; penalize slow wandering.
    this.genome.progress=this.progress;this.genome.maxSpeed=this.maxSpeed;this.genome.finished=this.finished;
    this.genome.fitness=this.progress*1000+Math.min(this.maxSpeed,20)*2+(this.finished?1500:0)-this.age*.12;
  }
  updateVisual(){
    this.group.position.copy(this.pos);
    this.group.rotation.order='YXZ';this.group.rotation.set(this.pitch,this.yaw,this.roll);
  }
  dispose(){this.group.parent?.remove(this.group);}
}
