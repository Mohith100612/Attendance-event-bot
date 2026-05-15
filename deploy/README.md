# EC2 Deployment Guide

## Before you start

You need:
- A **t2.medium** EC2 instance running Ubuntu 22.04 LTS
- Ports **22, 80, 443** open in the Security Group
- An **Elastic IP** allocated and associated with the instance
- Your **domain's A record** pointing at the Elastic IP
- Your **git repository** pushed to GitHub/GitLab

## Step 1 — Fill in setup.sh

Open `deploy/setup.sh` and edit the top 5 lines:

```bash
REPO_URL="https://github.com/YOUR_USERNAME/YOUR_REPO.git"
DOMAIN="yourdomain.com"
DB_PASSWORD="choose_a_strong_db_password"
ADMIN_EMAIL="admin@yourdomain.com"
ADMIN_PASSWORD="choose_a_strong_admin_password"
```

## Step 2 — Copy to EC2 and run

```bash
# Copy the script to the server
scp -i your-key.pem deploy/setup.sh ubuntu@YOUR_EC2_IP:~/

# SSH in
ssh -i your-key.pem ubuntu@YOUR_EC2_IP

# Run (takes ~3-5 minutes — fastembed + onnxruntime download)
chmod +x setup.sh
./setup.sh
```

## Step 3 — Verify

```bash
curl http://localhost:8000/health      # → {"status":"ok"}
sudo journalctl -u face-auth -f       # watch backend logs
```

Open `https://yourdomain.com` in a browser — login page should appear.

## Deploying updates

After pushing new code:

```bash
ssh -i your-key.pem ubuntu@YOUR_EC2_IP
/opt/face_auth/Attendance-using-face-recogination/deploy/update.sh
```

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Backend won't start | `sudo journalctl -u face-auth -n 50` |
| Nginx config error | `sudo nginx -t` |
| Out of memory (OOM) | Edit service file: change `--workers 2` to `--workers 1`, then `sudo systemctl restart face-auth` |
| First search request is slow | Normal — FastEmbed downloads the BAAI/bge-small-en-v1.5 model on first init, ~30s |
| Backend OOM during search | The embedding model needs ~400MB RAM per worker. Drop `--workers 2` to `--workers 1` if t2.medium is tight |
| CORS error in browser | Check `ALLOW_ORIGINS` in `.env` exactly matches your domain |
| Certbot failed | Run after DNS propagates: `sudo certbot --nginx -d yourdomain.com -d www.yourdomain.com` |
