# SmartBuilder — production deployment

Self-hosted SmartBuilder on your own VPS, served at **smartbuilderusa.com**,
behind a password gate so only you and your testers can open it.

The stack is two containers: the **app** (Bun server + built React client)
and **MySQL 8** (all tenant data). The app port is bound to localhost only;
a reverse proxy on the host (Caddy, step 6) adds HTTPS via Let's Encrypt
and the password gate, and is the only public entry point.

> Sizing: for pilot testing (you + a few users), a small VPS is plenty —
> e.g. 2 vCPU / 4 GB RAM / 40 GB disk. App + MySQL together idle at a few
> hundred MB. Photos and blueprints are stored in the database, so watch
> disk growth over time (see "Monitoring" below) rather than RAM.

---

## 0. What you need

- A VPS with a public IPv4 address (Ubuntu 22.04/24.04 recommended)
- The domain **smartbuilderusa.com** (registered at Porkbun)
- This bundle (`smartbuilder-deploy/`) copied to the server
- 20 minutes

## 1. Point the domain at the VPS (DNS)

In Porkbun → Domain Management → smartbuilderusa.com → DNS Records, add:

| Type | Host | Answer            | TTL |
|------|------|-------------------|-----|
| A    | @    | `<VPS public IP>` | 600 |
| A    | www  | `<VPS public IP>` | 600 |

DNS can take a few minutes to propagate. Check with:

```bash
dig +short smartbuilderusa.com   # should print your VPS IP
```

Do this first — Let's Encrypt (step 6) needs the name resolving to the VPS.

## 2. Install Docker on the VPS

```bash
ssh root@<VPS IP>
curl -fsSL https://get.docker.com | sh
docker compose version   # sanity check
```

## 3. Upload the bundle and configure the environment

From your machine:

```bash
scp -r smartbuilder-deploy root@<VPS IP>:/opt/smartbuilder
```

On the VPS:

```bash
cd /opt/smartbuilder
cp .env.example .env
nano .env
```

Set strong, unique passwords (generate with `openssl rand -hex 24`):

- `MYSQL_ROOT_PASSWORD` — MySQL server admin (backups/admin only)
- `MYSQL_PASSWORD` — the app's own MySQL user
- Leave `MYSQL_DATABASE=smartbuilder`, `MYSQL_USER=smartbuilder`, `APP_PORT=3000`

`.env` is never committed or shared — it stays on the VPS.

## 4. Build and start the stack

```bash
cd /opt/smartbuilder
docker compose up -d --build
docker compose ps          # db: healthy, app: running
docker compose logs -f app # "database reachable" → "listening on …:3000"
```

On the first boot (empty data volume), MySQL automatically loads
`db/schema.sql`, creating all tables. Later boots skip it.

Quick local check (still on the VPS, before any proxy):

```bash
curl -s http://127.0.0.1:3000/healthz   # {"ok":true}
```

## 5. Seed the demo data (once)

This creates the two demo tenants with the app's own bootstrap logic —
the same data the pilot opens with (idempotent, safe to re-run):

```bash
docker compose exec app bun run seed
```

It seeds:

- **BUILDER001 — LOG Construction**: demo users (admin/manager/crew),
  clients, projects with jobs + tasks, timesheets, invoices, the starter
  services catalog, 2 demo vehicles, and the demo client-portal login
  `roberto.client@demo.smartbuilder` / `client123`
- **BUILDER002 — Demo Construction**: an empty tenant with one admin user

## 6. HTTPS + password gate (Caddy)

Caddy gets a Let's Encrypt certificate automatically and adds HTTP Basic
Auth in front of the app — one gate for you and your wife to test behind.

Install Caddy (Debian/Ubuntu):

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
```

Create the password hash (Caddy stores only a bcrypt hash, never the
password itself):

```bash
caddy hash-password --plaintext 'CHOOSE-A-STRONG-GATE-PASSWORD'
# copy the $2a$14$… output
```

Write `/etc/caddy/Caddyfile`:

```caddy
smartbuilderusa.com {
    basicauth {
        daniel $2a$14$PASTE-THE-HASH-HERE
    }
    reverse_proxy 127.0.0.1:3000
}

www.smartbuilderusa.com {
    redir https://smartbuilderusa.com{uri} permanent
}
```

Apply and verify:

```bash
systemctl reload caddy
curl -I https://smartbuilderusa.com        # 401 without credentials
curl -I https://daniel:PASS@smartbuilderusa.com  # 200 with them
```

Open https://smartbuilderusa.com in the browser: it asks for the gate
user/password once, then the app loads. Share those two values (through a
private channel) with whoever tests with you.

### Alternative: nginx + Certbot instead of Caddy

```bash
apt install -y nginx certbot python3-certbot-nginx apache2-utils
htpasswd -c /etc/nginx/.htpasswd daniel       # prompts for the password
```

`/etc/nginx/sites-available/smartbuilder`:

```nginx
server {
    listen 80;
    server_name smartbuilderusa.com www.smartbuilderusa.com;

    location / {
        auth_basic "SmartBuilder";
        auth_basic_user_file /etc/nginx/.htpasswd;
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        client_max_body_size 64m;   # blueprint/PDF uploads travel as data URLs
    }
}
```

```bash
ln -s /etc/nginx/sites-available/smartbuilder /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d smartbuilderusa.com -d www.smartbuilderusa.com
```

### About the gate

- The gate keeps the pilot private while the app still uses its pilot
  sign-in (pick your user on the login screen). Keep the gate on until
  real per-user passwords land.
- The client portal (`roberto.client@demo.smartbuilder` / `client123`) has
  its own password inside the app — the gate is an additional outer lock.
- To let a tester in, add another `basicauth` line (Caddy) or run
  `htpasswd /etc/nginx/.htpasswd <name>` (nginx). Revoking = delete the line.

## 7. Backups

All data (including every photo and blueprint) lives in the MySQL volume.
Nightly dump:

```bash
mkdir -p /opt/smartbuilder/backups
crontab -e
# add:
0 3 * * * cd /opt/smartbuilder && docker compose exec -T db mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" smartbuilder | gzip > backups/smartbuilder-$(date +\%F).sql.gz
```

(That cron line reads `$MYSQL_ROOT_PASSWORD` only if cron sources `.env`;
simpler: put the root password in a root-only file and use
`--defaults-extra-file`, or run the dump from a small script that does
`set -a; . ./.env; set +a` first. Copy backups off the VPS regularly —
a backup that lives only on the same disk is not a backup.)

## 8. Updating the app

When a new bundle arrives:

```bash
cd /opt/smartbuilder
docker compose up -d --build   # rebuilds the client + server image
```

Data is untouched (named volume). If a future bundle adds tables/columns,
its notes will ship the extra SQL to run once against the `db` service.

## 9. Monitoring & sizing

```bash
docker stats                       # live CPU/RAM of app + MySQL
docker compose exec db mysql -u root -p -e \
  "SELECT table_schema, ROUND(SUM(data_length+index_length)/1024/1024,1) AS mb FROM information_schema.tables GROUP BY 1;"
df -h /                            # disk headroom (photos grow the DB)
```

Rule of thumb: you are fine while RAM stays under ~70% and disk under
~70%. The first thing to grow is the database (inline photos/blueprints).
If the VPS ever feels tight, resizing the VPS up one tier is a 5-minute
job — no re-install, compose comes back up with `docker compose up -d`.

## 10. Operational notes

- **Server layout**: `server/src/actions.ts` is the app's business logic;
  `server/src/schema.ts` + `db/schema.sql` are the same tables declared
  for Drizzle and for MySQL. `shims/` holds the small stand-ins that let
  the source run outside the Muse runtime (RPC client + action runtime).
- **Maps**: the in-app map preview ships as a vendored runtime inside the
  client bundle; it needs outbound internet from the *phone/browser* to
  load map tiles, and degrades to a coordinate readout offline.
- **Offline field work**: check-ins taken without signal queue in the
  phone's IndexedDB and replay when it reconnects — server state wins.
- **Times** are stored as ms-epoch (UTC instants) in the database; the app
  renders them in the viewer's local timezone, same as the pilot.
- The Muse-hosted pilot keeps working independently — this bundle neither
  reads nor writes it.
...[truncated 6151 chars]