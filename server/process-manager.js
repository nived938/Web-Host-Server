import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const children = new Map();

export function startProject(project, env = {}, onLine = () => {}) {
 if (children.has(project.id)) throw new Error("Project is already running");
 fs.mkdirSync(path.dirname(project.logPath), {recursive:true});
 const log = fs.createWriteStream(project.logPath, {flags:"a"});
 const child = spawn("cmd.exe", ["/d", "/s", "/c", project.start_command], {
   cwd: project.project_path,
   env: {...process.env, ...env, PORT:String(project.port), NODE_ENV:env.NODE_ENV||"production"},
   windowsHide:true
 });
 const write = data => { const text=data.toString(); log.write(text); onLine(text); };
 child.stdout.on("data", write);
 child.stderr.on("data", write);
 child.on("error", err => write(`\n[PlayOrg process error] ${err.message}\n`));
 child.on("exit", (code,signal) => { write(`\n[PlayOrg process exited] code=${code} signal=${signal}\n`); log.end(); children.delete(project.id); });
 children.set(project.id,{child,log});
 return child.pid;
}

export function stopProject(id) {
 const item=children.get(id);
 if(!item) return false;
 try { item.child.kill(); } catch {}
 children.delete(id);
 return true;
}

export function restartProject(project, env, onLine) {
 stopProject(project.id);
 return startProject(project,env,onLine);
}

export function isRunning(id) { return children.has(id); }
export function runningPid(id) { return children.get(id)?.child.pid || null; }
export function stopAll() { for(const id of children.keys()) stopProject(id); }
