import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { randomBytes, timingSafeEqual } from "crypto";
import { listProjects, getProject, getProjectByName, createProject, getEnv, setEnv, removeEnv, deleteProject, updateProject, nextPort } from "./database.js";
import { deployProject, safeName } from "./deployer.js";
import { stopProject, restartProject, isRunning } from "./process-manager.js";

const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);
const ROOT=path.resolve(__dirname,"..");
const readJSON=p=>JSON.parse(fs.readFileSync(p,"utf8"));
const config=readJSON(path.join(ROOT,"config","config.json"));
const projectsDir=path.resolve(ROOT,config.projectsDirectory);
const logsDir=path.resolve(ROOT,config.logsDirectory);
fs.mkdirSync(projectsDir,{recursive:true});
fs.mkdirSync(logsDir,{recursive:true});

const app=express();
app.use(cors());
app.use(express.json({limit:"1mb"}));

const dashboardToken=process.env.PLAYORG_ADMIN_TOKEN || "";
function auth(req,res,next){
 if(!dashboardToken) return next();
 const supplied=req.get("x-playorg-token") || req.query.token || "";
 const a=Buffer.from(supplied); const b=Buffer.from(dashboardToken);
 if(a.length!==b.length || !timingSafeEqual(a,b)) return res.status(401).json({success:false,error:"Unauthorized"});
 next();
}

app.get("/api/health",(req,res)=>res.json({status:"online",platform:"PlayOrg",domain:config.domain,serverPort:config.serverPort,projects:listProjects().length}));
app.get("/api/projects",auth,(req,res)=>res.json({success:true,projects:listProjects().map(p=>({...p,running:isRunning(p.id)}))}));
app.get("/api/projects/:name",auth,(req,res)=>{const p=getProjectByName(req.params.name); if(!p)return res.status(404).json({success:false,error:"Project not found"}); res.json({success:true,project:p,running:isRunning(p.id)});});

app.post("/api/projects/deploy",auth,async(req,res)=>{
 try { const project=await deployProject(req.body,config); res.status(201).json({success:true,project}); }
 catch(e){ console.error(e); res.status(400).json({success:false,error:e.message}); }
});

app.post("/api/projects/:id/restart",auth,(req,res)=>{try{const p=getProject(req.params.id);if(!p)return res.status(404).json({error:"Project not found"});const env=Object.fromEntries(getEnv(p.id).map(x=>[x.variable_name,x.variable_value]));const pid=restartProject({...p,logPath:path.join(logsDir,`${p.name}.log`)},env);updateProject(p.id,{status:"running",processId:pid});res.json({success:true,project:getProject(p.id)});}catch(e){res.status(500).json({success:false,error:e.message});}});
app.post("/api/projects/:id/stop",auth,(req,res)=>{const p=getProject(req.params.id);if(!p)return res.status(404).json({error:"Project not found"});stopProject(p.id);updateProject(p.id,{status:"stopped",processId:null});res.json({success:true,project:getProject(p.id)});});
app.delete("/api/projects/:id",auth,(req,res)=>{const p=getProject(req.params.id);if(!p)return res.status(404).json({error:"Project not found"});stopProject(p.id);deleteProject(p.id);try{fs.rmSync(p.project_path,{recursive:true,force:true});}catch{}res.json({success:true});});

app.get("/api/projects/:id/env",auth,(req,res)=>{const p=getProject(req.params.id);if(!p)return res.status(404).json({error:"Project not found"});res.json({success:true,variables:getEnv(p.id).map(x=>({name:x.variable_name,value:x.variable_value}))});});
app.put("/api/projects/:id/env",auth,(req,res)=>{const p=getProject(req.params.id);if(!p)return res.status(404).json({error:"Project not found"});const {name,value}=req.body||{};if(!name)return res.status(400).json({error:"name is required"});setEnv(p.id,String(name),String(value??""));res.json({success:true});});
app.delete("/api/projects/:id/env/:name",auth,(req,res)=>{const p=getProject(req.params.id);if(!p)return res.status(404).json({error:"Project not found"});res.json({success:removeEnv(p.id,req.params.name)});});

app.get("/api/projects/:id/logs",auth,(req,res)=>{const p=getProject(req.params.id);if(!p)return res.status(404).json({error:"Project not found"});const file=path.join(logsDir,`${p.name}.log`);res.type("text").send(fs.existsSync(file)?fs.readFileSync(file,"utf8"):"");});

app.get("/api/ports/next",auth,(req,res)=>res.json({port:nextPort(config.projectPortStart,config.projectPortEnd)}));

const dashboard=path.join(ROOT,config.dashboardDirectory);
app.use(express.static(dashboard));
app.get("*",(req,res)=>res.sendFile(path.join(dashboard,"index.html")));

app.listen(config.serverPort,"0.0.0.0",()=>{
 console.log("=================================");
 console.log("        PLAYORG SERVER");
 console.log("=================================");
 console.log(`Domain:       ${config.domain}`);
 console.log(`Dashboard:    http://localhost:${config.serverPort}`);
 console.log(`Projects:     ${config.projectPortStart}-${config.projectPortEnd}`);
 console.log(`Admin auth:   ${dashboardToken?"enabled":"disabled"}`);
 console.log("Status:       ONLINE");
 console.log("=================================");
});

process.on("SIGINT",()=>process.exit(0));
process.on("SIGTERM",()=>process.exit(0));
