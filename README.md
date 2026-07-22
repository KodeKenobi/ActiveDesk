# ActiveDesk

Electron desktop app to help keep your presence active while using Teams, Slack, and similar collaboration tools.

## Licensing

ActiveDesk now supports offline license activation with three plans:

- Lifetime: $10
- Weekly: $2
- Monthly: $5

The app verifies license keys locally. Buyers can download the app from GitHub, pay through PayFast, then receive a key manually by email.

### First-time setup

Run this once on your machine to generate the signing keys and sync the public key into the app:

```bash
npm run license:init
```

This creates a private key in `license-keys/` and a public key in `assets/license-public.pem`.

### Generate a license

```bash
npm run license:generate -- --plan lifetime --email buyer@example.com --payment-ref PF123
```

Valid plans are `lifetime`, `weekly`, and `monthly`.

Each generated key is appended to `sales/issued-licenses.jsonl`, which acts as the phase-1 text-file sales database.
