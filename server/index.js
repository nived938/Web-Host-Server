import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { timingSafeEqual } from "crypto";
import httpProxy from "http-proxy";
import { listProjects,getProject,getProjectByName,getEnv,setEnv,removeEnv,deleteProject,updateProject,nextPort } from "./database.js";
import { deployProject } from "./deployer.js";
import { stopProject,restartProject,isRunning } from "./process-manager.js";
import { syncCaddy } from "./caddy.js";

const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);
const ROOT=path.resolve(__dirname,"..");
const config=JSON.parse(fs.readFileSync(path.join(ROOT,"config","config.json"),"utf8"));
const projectsDir=path.resolve(ROOT,config.projectsDirectory);
const logsDir=path.resolve(ROOT,config.logsDirectory);
fs.mkdirSync(projectsDir,{recursive:true});
fs.mkdirSync(logsDir,{recursive:true});

const app=express();
app.use(cors());
const dashboardToken=process.env.PLAYORG_ADMIN_TOKEN||"";

function auth(req,res,next){
  if(!dashboardToken)return next();
  const supplied=req.get("x-playorg-token")||req.query.token||"";
  const a=Buffer.from(supplied),b=Buffer.from(dashboardToken);
  if(a.length!==b.length||!timingSafeEqual(a,b))return res.status(401).json({success:false,error:"Unauthorized"});
  next();
}

function projectFromParam(value){
  if(/^\d+$/.test(String(value)))return getProject(Number(value));
  return getProjectByName(String(value));
}

function publicProjectUrl(project){
  const scheme=config.publicProtocol||"https";
  return `${scheme}://${project.name}.${config.domain}`;
}

async function refreshCaddy(){
  try{return await syncCaddy(ROOT,config.domain,listProjects(),console);}catch(error){console.warn("Caddy sync failed:",error.message);return null;}
}

app.use("/api",express.json({limit:"2mb"}));
app.get("/api/health",(req,res)=>res.json({status:"online",platform:"PlayOrg",domain:config.domain,serverPort:config.serverPort,projects:listProjects().length,https:config.publicProtocol==="https"}));
app.get("/api/public-info",(req,res)=>res.json({domain:config.domain,protocol:config.publicProtocol||"https",freeDnsUrl:"https://freedns.afraid.org/subdomain/",dnsInstructions:`Create an A record for PROJECT.${config.domain} pointing to your public IP.`}));
app.get("/api/projects",auth,(req,res)=>res.json({success:true,projects:listProjects().map(p=>({...p,running:isRunning(p.id),publicUrl:publicProjectUrl(p),dnsRecord:`${p.name}.${config.domain}`}))}));
app.get("/api/projects/:id",auth,(req,res)=>{
  const p=projectFromParam(req.params.id);
  if(!p)return res.status(404).json({success:false,error:"Project not found"});
  res.json({success:true,project:{...p,publicUrl:publicProjectUrl(p),dnsRecord:`${p.name}.${config.domain}`},running:isRunning(p.id)});
});
app.post("/api/projects/deploy",auth,async(req,res)=>{
  try{const project=await deployProject(req.body,config);await refreshCaddy();res.status(201).json({success:true,project:{...project,publicUrl:publicProjectUrl(project),dnsRecord:`${project.name}.${config.domain}`}});}
  catch(e){console.error(e);res.status(400).json({success:false,error:e.message});}
});
app.put("/api/projects/:id/settings",auth,(req,res)=>{
  const p=projectFromParam(req.params.id);
  if(!p)return res.status(404).json({success:false,error:"Project not found"});
  try{
    const {branch,rootDirectory,buildCommand,startCommand,autoDeploy}=req.body||{};
    const updated=updateProject(p.id,{branch,rootDirectory,buildCommand,startCommand,autoDeploy});
    res.json({success:true,project:{...updated,publicUrl:publicProjectUrl(updated),dnsRecord:`${updated.name}.${config.domain}`}});
  }catch(e){res.status(400).json({success:false,error:e.message});}
});
app.post("/api/projects/:id/restart",auth,async(req,res)=>{
  try{
    const p=projectFromParam(req.params.id);
    if(!p)return res.status(404).json({error:"Project not found"});
    const env=Object.fromEntries(getEnv(p.id).map(x=>[x.variable_name,x.variable_value]));
    env.PORT=String(p.port);env.NODE_ENV=env.NODE_ENV||"production";
    const pid=restartProject({...p,logPath:path.join(logsDir,`${p.name}.log`)},env);
    updateProject(p.id,{status:"running",processId:pid});
    await refreshCaddy();
    res.json({success:true,project:{...getProject(p.id),publicUrl:publicProjectUrl(p),dnsRecord:`${p.name}.${config.domain}`}});
  }catch(e){res.status(500).json({success:false,error:e.message});}
});
app.post("/api/projects/:id/stop",auth,async(req,res)=>{
  const p=projectFromParam(req.params.id);
  if(!p)return res.status(404).json({error:"Project not found"});
  stopProject(p.id);updateProject(p.id,{status:"stopped",processId:null});
  await refreshCaddy();
  res.json({success:true,project:{...getProject(p.id),publicUrl:publicProjectUrl(p),dnsRecord:`${p.name}.${config.domain}`}});
});
app.delete("/api/projects/:id",auth,async(req,res)=>{
  const p=projectFromParam(req.params.id);
  if(!p)return res.status(404).json({error:"Project not found"});
  stopProject(p.id);deleteProject(p.id);
  try{fs.rmSync(path.resolve(p.project_path.split(path.sep).slice(0,-1).join(path.sep)),{recursive:true,force:true});}catch{}
  await refreshCaddy();
  res.json({success:true});
});
app.get("/api/projects/:id/env",auth,(req,res)=>{
  const p=projectFromParam(req.params.id);
  if(!p)return res.status(404).json({error:"Project not found"});
  res.json({success:true,variables:getEnv(p.id).map(x=>({name:x.variable_name,value:x.is_secret?"••••••••":x.variable_value,isSecret:!!x.is_secret}))});
});
app.put("/api/projects/:id/env",auth,(req,res)=>{
  const p=projectFromParam(req.params.id);
  if(!p)return res.status(404).json({error:"Project not found"});
  const {name,value,isSecret}=req.body||{};
  if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(name||"")))return res.status(400).json({error:"Invalid environment variable name"});
  setEnv(p.id,String(name),String(value??""),isSecret!==false);
  res.json({success:true});
});
app.delete("/api/projects/:id/env/:name",auth,(req,res)=>{
  const p=projectFromParam(req.params.id);
  if(!p)return res.status(404).json({error:"Project not found"});
  res.json({success:removeEnv(p.id,req.params.name)});
});
app.get("/api/projects/:id/logs",auth,(req,res)=>{
  const p=projectFromParam(req.params.id);
  if(!p)return res.status(404).json({error:"Project not found"});
  const file=path.join(logsDir,`${p.name}.log`);
  res.type("text").send(fs.existsSync(file)?fs.readFileSync(file,"utf8"):"");
});
app.get("/api/ports/next",auth,(req,res)=>res.json({port:nextPort(config.projectPortStart,config.projectPortEnd)}));

const proxy=httpProxy.createProxyServer({changeOrigin:true});
proxy.on("error",(err,req,res)=>{if(!res.headersSent)res.status(502).send(`PlayOrg proxy error: ${err.message}`);});
function proxyProject(project,req,res){proxy.web(req,res,{target:`http://127.0.0.1:${project.port}`,changeOrigin:true});}

const dashboard=path.join(ROOT,config.dashboardDirectory);

// Inject small PlayOrg-specific UI helpers without requiring users to edit the dashboard file.
app.get("/",(req,res)=>{
  const file=path.join(dashboard,"index.html");
  let html=fs.readFileSync(file,"utf8");
  html=html.replaceAll("xyz12.site",config.domain);
  html=html.replace("</body>",`<script>
(function(){
  const freeDnsUrl="https://freedns.afraid.org/subdomain/";
  const addFreeDns=()=>{
    if(document.getElementById("playorgFreeDnsButton"))return;
    const title=[...document.querySelectorAll("h1")].find(x=>x.textContent.trim()==="New Web Service");
    const shell=title?.closest(".form-shell");
    if(!shell)return;
    const box=document.createElement("div");
    box.id="playorgFreeDnsButton";
    box.style.cssText="border:1px solid #4a4d4e;background:#111314;padding:16px 18px;margin:0 0 24px;display:flex;align-items:center;justify-content:space-between;gap:15px";
    box.innerHTML='<div><strong>Custom domain with FreeDNS</strong><div style="color:#a1a5a7;font-size:12px;margin-top:5px">Create an A record such as PROJECT.${config.domain} pointing to your public IP.</div></div><a href="'+freeDnsUrl+'" target="_blank" rel="noopener"><button type="button" class="primary">Open FreeDNS DNS Manager ↗</button></a>';
    title.insertAdjacentElement("afterend",box);
  };
  new MutationObserver(addFreeDns).observe(document.body,{childList:true,subtree:true});
  addFreeDns();
})();
</script></body>`);
  res.type("html").send(html);
});
app.use(express.static(dashboard));
app.use((req,res)=>{
  const host=(req.hostname||"").toLowerCase().split(":")[0];
  const suffix=`.${config.domain.toLowerCase()}`;
  if(host.endsWith(suffix)){
    const sub=host.slice(0,-suffix.length);
    if(sub && !sub.includes(".")){
      const project=getProjectByName(sub);
      if(!project)return res.status(404).send("PlayOrg project not found");
      return proxyProject(project,req,res);
    }
  }
  const parts=req.path.split("/").filter(Boolean);
  if(parts.length){
    const project=getProjectByName(parts[0]);
    if(project){
      const originalUrl=req.url;
      const prefix=`/${parts[0]}`;
      req.url=originalUrl===prefix?"/":originalUrl.startsWith(prefix+"/")?originalUrl.slice(prefix.length)||"/":originalUrl;
      return proxyProject(project,req,res);
    }
  }
  return res.sendFile(path.join(dashboard,"index.html"));
});

app.listen(config.serverPort,"0.0.0.0",async()=>{
  console.log("=================================");
  console.log("        PLAYORG SERVER");
  console.log("=================================");
  console.log(`Domain:       ${config.domain}`);
  console.log(`Dashboard:    http://localhost:${config.serverPort}`);
  console.log(`Projects:     ${config.projectPortStart}-${config.projectPortEnd}`);
  console.log(`Public URLs:  ${config.publicProtocol||"https"}://PROJECT.${config.domain}`);
  console.log(`FreeDNS:      https://freedns.afraid.org/subdomain/`);
  console.log(`Admin auth:   ${dashboardToken?"enabled":"disabled"}`);
  console.log("Status:       ONLINE");
  console.log("=================================");
  await refreshCaddy();
});
process.on("SIGINT",()=>process.exit(0));
process.on("SIGTERM",()=>process.exit(0));
