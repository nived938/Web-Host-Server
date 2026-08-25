# PlayOrg Web Host Server

PlayOrg is a Windows self-hosted hosting platform designed to run multiple websites and Node.js applications from one PC. It is inspired by the basic deployment workflow of services such as Render, but runs on your own machine.

## Features

- Git HTTPS deployment
- Multiple projects
- Automatic project port allocation
- Build commands
- Start commands
- Per-project environment variables
- Start, stop and restart
- SQLite project database
- Deployment/runtime logs
- Web dashboard
- Health API
- Designed for Cloudflare Tunnel
- Windows process management
- Custom domain/subdomain routing can be added through a reverse proxy/tunnel

## Requirements

- Windows 10/11
- Node.js 20+
- npm
- Git
- A domain, for example `xyz12.site`
- Cloudflare account for public HTTPS access

## Install

```powershell
git clone https://github.com/nived938/Web-Host-Server.git
cd Web-Host-Server
npm install
npm start
```

Open `http://localhost:3000`.

Health check: `http://localhost:3000/api/health`.

## Configuration

Edit `config/config.json`:

- `domain`: your base domain
- `serverPort`: PlayOrg dashboard/API port
- `projectPortStart` and `projectPortEnd`: application port pool

## Admin security

For local testing, authentication is disabled by default. Before exposing PlayOrg to the internet, set a strong environment variable:

```powershell
$env:PLAYORG_ADMIN_TOKEN="replace-with-a-long-random-secret"
npm start
```

The dashboard will send this token using `x-playorg-token`.

For permanent Windows setup, configure `PLAYORG_ADMIN_TOKEN` as a system/user environment variable rather than committing it to Git.

## Deploy a project

From the dashboard, provide:

- project name
- HTTPS Git repository URL
- branch
- build command, optional
- start command

PlayOrg clones the repository, runs the build command if supplied, assigns a free port from the configured range, and starts the application with `PORT` set to that port.

## Important security note

A hosting platform executes code from repositories you deploy. Only deploy repositories you trust. Do not expose the dashboard/API publicly without authentication and a secure tunnel. Never commit secrets, API keys, passwords, or `.env` files to this repository.

## Cloudflare Tunnel

For public access, use a Cloudflare Tunnel from your PC to the PlayOrg server. Do not open random inbound router ports just to expose individual projects. The next routing layer can map subdomains such as:

`my-project.xyz12.site` → PlayOrg → the project's local port.

## Architecture

```text
Internet
   |
Cloudflare
   |
Cloudflare Tunnel
   |
Your Windows PC
   |
PlayOrg :3000
   +-- Dashboard/API
   +-- Project :31000
   +-- Project :31001
   +-- Project :31002
   +-- ...
```

## Current scope

This repository is the core Windows hosting control plane. Production hardening, automatic GitHub webhooks, isolated build environments, HTTPS/subdomain routing, resource limits, and a richer deployment log stream should be added before offering hosting to other people.
