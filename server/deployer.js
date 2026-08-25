import fs from "fs";
import path from "path";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { createProject, getProject, getEnv, updateProject } from "./database.js";
import { startProject, stopProject } from "./process-manager.js";

const execFileAsync = promisify(execFile);

function safeName(name){
 const n=String(name||"").trim().toLowerCase().replace(/[^a-z0-9-]/g,"-").replace(/-+/g,"-").replace(/^-|-$/g,"");
 if(!n || n.length>50) throw new Error("Project name must contain 1-50 letters, numbers or hyphens");
 return n;
}

export async function gitClone(repository, branch, destination){
 fs.mkdirSync(path.dirname(destination),{recursive:true});
 await execFileAsync("git",["clone","--depth","1","--branch",branch||"main",repository,destination],{windowsHide:true,maxBuffer:10*1024*1024});
}

export async function runCommand(command,cwd,env={},logFile){
 if(!command) return;
 fs.mkdirSync(path.dirname(logFile),{recursive:true});
 const log=fs.createWriteStream(logFile,{flags:"a"});
 return new Promise((resolve,reject)=>{
   const child=spawn("cmd.exe",["/d","/s","/c",command],{cwd,env:{...process.env,...env},windowsHide:true});
   child.stdout.on("data",d=>log.write(d));
   child.stderr.on("data",d=>log.write(d));
   child.on("error",e=>{log.end();reject(e);});
   child.on("exit",code=>{log.end(); if(code===0) resolve(); else reject(new Error(`Command failed with exit code ${code}: ${command}`));});
 });
}

export async function deployProject(input, config){
 const name=safeName(input.name);
 if(!input.repository) throw new Error("GitHub repository is required");
 if(!/^https:\/\/(github\.com|gitlab\.com|bitbucket\.org)\//i.test(input.repository)) throw new Error("Only HTTPS GitHub, GitLab and Bitbucket repositories are supported");
 const existing=await import("./database.js").then(m=>m.getProjectByName(name));
 if(existing) throw new Error("A project with this name already exists");
 const port=await import("./database.js").then(m=>m.nextPort(config.projectPortStart,config.projectPortEnd));
 const projectPath=path.resolve(config.projectsDirectory,name);
 const logPath=path.resolve(config.logsDirectory,`${name}.log`);
 const project=createProject({name,repository:input.repository,branch:input.branch||"main",port,buildCommand:input.buildCommand||"",startCommand:input.startCommand||"npm start",projectPath});
 updateProject(project.id,{status:"cloning"});
 try {
   await gitClone(project.repository,project.branch,project.project_path);
   updateProject(project.id,{status:"building"});
   const env=Object.fromEntries(getEnv(project.id).map(x=>[x.variable_name,x.variable_value]));
   if(input.buildCommand) await runCommand(input.buildCommand,project.project_path,env,logPath);
   updateProject(project.id,{status:"starting"});
   const pid=startProject({...project,logPath},env);
   updateProject(project.id,{status:"running",processId:pid});
   return getProject(project.id);
 } catch(error) {
   updateProject(project.id,{status:"failed",processId:null});
   throw error;
 }
}

export { safeName };
