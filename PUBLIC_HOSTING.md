# PlayOrg public hosting with FreeDNS + HTTPS

PlayOrg uses FreeDNS for DNS and Caddy for free automatic HTTPS certificates.

## 1. Create the FreeDNS A record

For every deployed project, create an A record in FreeDNS:

- Type: `A`
- Subdomain: your project name, for example `my-chatgpt`
- Domain: `xyz.joe.dj`
- Destination: your current public IPv4 address

This creates:

`my-chatgpt.xyz.joe.dj`

PlayOrg does not require FreeDNS wildcard DNS.

## 2. Install Caddy on Windows

Install the Windows Caddy executable and make sure `caddy.exe` is available from PowerShell:

```powershell
caddy version
```

PlayOrg automatically generates `caddy/Caddyfile` and reloads Caddy whenever a project is deployed, restarted, stopped, or deleted.

## 3. Forward ports from your router

Forward these ports to the Windows PC running PlayOrg:

- TCP 80 -> the PC
- TCP 443 -> the PC

Also allow Caddy through Windows Firewall when Windows asks.

You do not need to expose ports 31000-31999 to the internet. Only Caddy needs ports 80 and 443.

## 4. Start PlayOrg

```powershell
npm install
npm start
```

PlayOrg will generate HTTPS routes such as:

`https://my-chatgpt.xyz.joe.dj`

Caddy obtains and renews the public TLS certificate automatically when the hostname resolves to your public IP and ports 80/443 are reachable.

## 5. Dynamic public IP

If your public IP changes, update the FreeDNS A records. FreeDNS provides update URLs/clients for dynamic DNS.

## Important CGNAT note

If your ISP uses CGNAT, normal router port forwarding will not make ports 80/443 reachable from the internet. In that case use a Cloudflare Tunnel instead. Cloudflare Tunnel works through outbound connections and does not require inbound ports.
