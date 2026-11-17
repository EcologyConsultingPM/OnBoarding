import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../lib/projectSourceSignals.js',import.meta.url),'utf8');
function load(storageThrows=false) {
 const events=[];const values=[];
 const context=vm.createContext({Date,Math,JSON,CustomEvent:class {constructor(type,options){this.type=type;this.detail=options.detail;}},window:{dispatchEvent:e=>events.push(e),localStorage:{setItem:(key,value)=>{if(storageThrows)throw Error('storage denied');values.push([key,JSON.parse(value)]);}}}});
 vm.runInContext(source.replaceAll('export ', '')+'\nthis.signal=signalProjectSourceChange;',context);return {signal:context.signal,events,values};
}
const normal=load();normal.signal('/api/projects/project-123/activities');assert.equal(normal.events[0].type,'ec:project-sources-changed');assert.equal(normal.events[0].detail.projectId,'project-123');assert.equal(normal.values[0][0],'ec:project-sources-changed');assert.deepEqual(Object.keys(normal.events[0].detail).sort(),['changedAt','projectId']);assert.deepEqual(Object.keys(normal.values[0][1]).sort(),['changedAt','nonce','projectId']);
const denied=load(true);assert.doesNotThrow(()=>denied.signal('/api/projects/new-id'));assert.equal(denied.events.length,1);
const server=vm.createContext({});vm.runInContext(source.replaceAll('export ','')+'\nthis.signal=signalProjectSourceChange;',server);assert.doesNotThrow(()=>server.signal('/api/projects'));
const ui=fs.readFileSync(new URL('../components/AdminProjectSetup.js',import.meta.url),'utf8');const block=ui.slice(ui.indexOf('const auth = useCallback'),ui.indexOf('const notify = useCallback'));assert.match(block,/response\.ok && method !== "GET"/);assert.match(block,/cache: "no-store"/);assert.match(block,/signalProjectSourceChange\(url\)/);
console.log('PASS successful project-write invalidation, minimal cross-tab signal, denied storage and server safety.');

const planner=fs.readFileSync(new URL('../components/StaffCapacityPlanner.js',import.meta.url),'utf8');
const freshness=planner.slice(planner.indexOf('// Another staff member may save'));
const timerBody=freshness.match(/useEffect\(\(\) => \{([\s\S]*?)\}, \[load, session\?\.access_token\]\)/)?.[1];assert.ok(timerBody,'Mounted visible-calendar freshness effect must exist');
function timerFixture(token='token'){
 let tick;let count=0;let cleared=false;let interval;
 const environment=vm.createContext({session:token?{access_token:token}:null,document:{hidden:false},activeRequestRef:{current:null},load:()=>count++,window:{setInterval:(callback,ms)=>{tick=callback;interval=ms;return 42;},clearInterval:id=>{assert.equal(id,42);cleared=true;}}});
 const cleanup=vm.runInContext('(function(){'+timerBody+'})()',environment);
 return {environment,cleanup,get tick(){return tick;},get count(){return count;},get cleared(){return cleared;},get interval(){return interval;}};
}
const timer=timerFixture();assert.equal(timer.interval,60000);timer.tick();assert.equal(timer.count,1);timer.environment.document.hidden=true;timer.tick();assert.equal(timer.count,1);timer.environment.document.hidden=false;timer.environment.activeRequestRef.current={};timer.tick();assert.equal(timer.count,1);timer.cleanup();assert.equal(timer.cleared,true);
assert.equal(timerFixture(null).tick,undefined);
console.log('PASS visible-only signed-in freshness, no overlapping GET, 60-second bound and unmount cleanup.');
