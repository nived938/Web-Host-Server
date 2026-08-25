import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);
const ROOT=path.resolve(__dirname,"..");
const DATA=path.join(ROOT,"data");
fs.mkdirSync(DATA,{recursive:true});
const db=new Database(path.join(DATA,"playorg.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS projects (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL UNIQUE,
 repository TEXT NOT NULL,
 branch TEXT NOT NULL DEFAULT 'main',
 root_directory TEXT NOT NULL DEFAULT '',
 port INTEGER NOT NULL UNIQUE,
 build_command TEXT NOT NULL DEFAULT '',
 start_command TEXT NOT NULL DEFAULT 'npm start',
 status TEXT NOT NULL DEFAULT 'created',
 project_path TEXT NOT NULL,
 process_id INTEGER,
 auto_deploy INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS environment_variables (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 project_id INTEGER NOT NULL,
 variable_name TEXT NOT NULL,
 variable_value TEXT NOT NULL,
 is_secret INTEGER NOT NULL DEFAULT 1,
 FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
 UNIQUE(project_id, variable_name)
);
`);
try{db.prepare("ALTER TABLE projects ADD COLUMN root_directory TEXT NOT NULL DEFAULT ''").run();}catch{}
try{db.prepare("ALTER TABLE projects ADD COLUMN auto_deploy INTEGER NOT NULL DEFAULT 1").run();}catch{}
try{db.prepare("ALTER TABLE environment_variables ADD COLUMN is_secret INTEGER NOT NULL DEFAULT 1").run();}catch{}

export const listProjects=()=>db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all();
export const getProject=id=>db.prepare("SELECT * FROM projects WHERE id=?").get(id);
export const getProjectByName=name=>db.prepare("SELECT * FROM projects WHERE name=?").get(name);
export const getProjectByPort=port=>db.prepare("SELECT * FROM projects WHERE port=?").get(port);
export function createProject(p){const r=db.prepare(`INSERT INTO projects(name,repository,branch,root_directory,port,build_command,start_command,project_path,auto_deploy) VALUES(?,?,?,?,?,?,?,?,?)`).run(p.name,p.repository,p.branch||"main",p.rootDirectory||"",p.port,p.buildCommand||"",p.startCommand||"npm start",p.projectPath,p.autoDeploy===false?0:1);return getProject(r.lastInsertRowid);}
export function updateProject(id,fields){const allowed={status:"status",processId:"process_id",port:"port",buildCommand:"build_command",startCommand:"start_command",branch:"branch",rootDirectory:"root_directory",autoDeploy:"auto_deploy"};const entries=Object.entries(fields).filter(([k,v])=>allowed[k]&&v!==undefined);if(!entries.length)return getProject(id);const sql=entries.map(([k])=>`${allowed[k]}=?`).join(", ");db.prepare(`UPDATE projects SET ${sql}, updated_at=CURRENT_TIMESTAMP WHERE id=?`).run(...entries.map(([k,v])=>k==="autoDeploy"?(v?1:0):v),id);return getProject(id);}
export const deleteProject=id=>db.prepare("DELETE FROM projects WHERE id=?").run(id).changes>0;
export const nextPort=(start=31000,end=31999)=>{const used=new Set(listProjects().map(p=>p.port));for(let p=start;p<=end;p++)if(!used.has(p))return p;throw new Error("No free project ports");};
export const setEnv=(projectId,name,value,isSecret=true)=>db.prepare(`INSERT INTO environment_variables(project_id,variable_name,variable_value,is_secret) VALUES(?,?,?,?) ON CONFLICT(project_id,variable_name) DO UPDATE SET variable_value=excluded.variable_value,is_secret=excluded.is_secret`).run(projectId,name,value,isSecret?1:0);
export const getEnv=projectId=>db.prepare("SELECT variable_name, variable_value, is_secret FROM environment_variables WHERE project_id=? ORDER BY variable_name").all(projectId);
export const removeEnv=(projectId,name)=>db.prepare("DELETE FROM environment_variables WHERE project_id=? AND variable_name=?").run(projectId,name).changes>0;
export default db;
