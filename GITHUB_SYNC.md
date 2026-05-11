# GitHub Sync

## First machine: push to GitHub

Create an empty GitHub repository named `shopeeAI`, then add it as remote:

```bash
git remote add origin https://github.com/<your-user>/shopeeAI.git
git push -u origin main
```

Use SSH if you prefer:

```bash
git remote add origin git@github.com:<your-user>/shopeeAI.git
git push -u origin main
```

## Other machines: install/update

Clone:

```bash
git clone https://github.com/<your-user>/shopeeAI.git
cd shopeeAI
npm install
cp .env.example .env
```

Update later:

```bash
./update-project.sh
```

After updating:

- restart API: `./start-server.sh`
- reload Chrome extension in `chrome://extensions`
- keep `.env` local; it is intentionally not committed
