# APEX MAIN – Supabase connection

Supabase project URL: https://xqkyaqxuoaxadpkcdhch.supabase.co
GitHub repository: https://github.com/invinity-8/APEX-C

The online multiplayer mode is implemented in APEX 0.2. Follow **[DEPLOYMENT.md](DEPLOYMENT.md)** for the
migrations, Auth settings, Vercel environment variables, preview tests and go-live, and
**[ARCHITECTURE.md](ARCHITECTURE.md)** for the security model.

No passwords or secret keys are stored in this repository. Each participant uses a separate Supabase Auth
email/password account. Never send passwords to the developer or commit them to GitHub.

Pre-existing tables `apex_invites` and `apex_access` (created manually before v0.2) are left untouched.
The seed migration imports their entries into `apex_campaign_invites` if they have `email` and `role` columns.
