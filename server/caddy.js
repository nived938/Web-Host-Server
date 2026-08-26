import fs from "fs";
import path from "path";
import { spawn, execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

function caddyFilePath(root) {
  return path.join(root, "caddy", "Caddyfile");
}

export function generateCaddyfile(root, domain, projects) {
  const lines = [
    "# Generated automatically by PlayOrg. Do not edit manually.",
    "# HTTPS is managed automatically by Caddy/Let's Encrypt.",
    "",
    `${domain} {`,
    "    reverse_proxy 127.0.0.1:3000",
    "    encode gzip",
    "}",
    ""
  ];

  for (const project of projects) {
    if (!project?.name || !project?.port) continue;
    lines.push(`${project.name}.${domain} {`);
    lines.push(`    reverse_proxy 127.0.0.1:${project.port}`);
    lines.push("    encode gzip");
    lines.push("}");
    lines.push("");
  }

  return lines.join("\n");
}

export async function syncCaddy(root, domain, projects, log = console) {
  const dir = path.join(root, "caddy");
  fs.mkdirSync(dir, { recursive: true });
  const file = caddyFilePath(root);
  fs.writeFileSync(file, generateCaddyfile(root, domain, projects), "utf8");

  try {
    await execFileAsync("caddy", ["validate", "--config", file, "--adapter", "caddyfile"], {
      windowsHide: true,
      maxBuffer: 2 * 1024 * 1024
    });

    try {
      await execFileAsync("caddy", ["reload", "--config", file, "--adapter", "caddyfile"], {
        windowsHide: true,
        maxBuffer: 2 * 1024 * 1024
      });
    } catch {
      const child = spawn("caddy", ["run", "--config", file, "--adapter", "caddyfile"], {
        detached: true,
        windowsHide: true,
        stdio: "ignore"
      });
      child.unref();
    }

    return { enabled: true, configPath: file };
  } catch (error) {
    log.warn?.(`Caddy is not available or could not be configured: ${error.message}`);
    return { enabled: false, configPath: file, error: error.message };
  }
}

export default syncCaddy;
