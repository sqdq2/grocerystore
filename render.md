# Deploying with a real database

> **If Render says `Could not open requirements file: 'requirements.txt'`**
> the service was created as a **Python** web service — usually because the
> repository was still empty when the service was created, so Render fell back
> to its Python buildpack. This is a Node project.
>
> **Fix:** delete that service, then create a new one from
> <https://dashboard.render.com> → **New +** → **Blueprint** → connect
> `sqdq2/grocerystore`. The committed `render.yaml` pins `runtime: node`,
> `buildCommand: npm install --omit=dev` and `startCommand: npm start`.
>
> **Or** keep the service and switch it: **Settings → Runtime → Node →
> Node version 22 → Save & Deploy**. (`.node-version` and `NODE_VERSION` both
> pin Node 22, which is required for the built-in `node:sqlite` module.)
>
> The `requirements.txt` error is unrelated to this project — there is no
> Python code here.

## Option A — Render (one click, free tier)

1. Push this repo to GitHub.
2. Go to <https://render.com> → **New +** → **Blueprint** → connect `sqdq2/grocerystore`.
3. Render reads `render.yaml`, creates the service and a 1 GB disk, and deploys.
4. Your app is live at `https://bijasan-grocery-store.onrender.com` with a
   persistent SQLite database on the disk.

`BGS_SECRET` is generated automatically, so sessions are signed per deployment.

## Option B — Docker anywhere

```bash
docker build -t bijasan-grocery .
docker run -p 3000:3000 -v grocery-data:/app/data bijasan-grocery
```

## Option C — any Node host

```bash
git clone https://github.com/sqdq2/grocerystore.git
cd grocerystore
npm start        # PORT=3000 by default
```

Set `PORT` and `BGS_SECRET` in the host's environment. The database file lives at
`data/store.db` and is created and seeded on first boot.
