# Deploying with a real database

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
