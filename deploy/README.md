# Deploy shopeeAI on Ubuntu VPS

This deploys the shopeeAI API/Admin server as a `systemd` service.

## One-command install

SSH to the VPS as root, then run:

```bash
curl -fsSL https://raw.githubusercontent.com/huynhlongdai/shopeeAI/main/deploy/ubuntu-server-setup.sh \
  -o /tmp/shopeeai-setup.sh
bash /tmp/shopeeai-setup.sh
```

Optional custom token:

```bash
API_TOKEN='change-this-long-random-token' bash /tmp/shopeeai-setup.sh
```

After install:

```text
Admin UI: http://<server-ip>:8787/admin/
Extension API Base: http://<server-ip>:8787
Extension API Token: value printed by the setup script
```

## Service commands

```bash
systemctl status shopeeai
systemctl restart shopeeai
journalctl -u shopeeai -f
```

## Update to latest GitHub version

```bash
cd /opt/shopeeAI
git pull --ff-only origin main
npm ci --omit=dev
systemctl restart shopeeai
```

## Architecture note

The VPS server is best used as the online queue/admin API. The Chrome extension should still run on the machine/profile that is already logged in to Shopee, Shopee Affiliate, and Facebook. Set every extension profile to:

```text
API Base: http://<server-ip>:8787
API Token: <same token from /opt/shopeeAI/.env>
Profile ID: profile-1, profile-2, ...
```

Do not expose this API publicly without a strong token, firewall rules, VPN, or a reverse proxy with authentication.
