# Security checklist before production

- [ ] Remove local `DEV_AUTH` bypass from production environment.
- [ ] Configure Cloudflare Access with Google IdP and explicit allowlist policy.
- [ ] Configure Access team domain and exact application audience; verify JWT rejection for missing/wrong issuer/audience.
- [ ] Insert only approved users into D1; keep Admin role assignments restricted.
- [ ] Review API authorization for every write route.
- [ ] Add a server-side permission table for transfer privileges instead of trusting any request-body field.
- [ ] Harden stock-changing operations for concurrent requests and confirm every D1 batch outcome.
- [ ] Back up the database before importing or applying migrations.
- [ ] Review logs for sensitive information; never log tokens or credentials.
- [ ] Configure rate limiting and notification-provider secrets where applicable.
