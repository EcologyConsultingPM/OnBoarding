# Private daily database backup

The workflow `.github/workflows/private-daily-database-backup.yml` creates roles, schema and data SQL dumps, compresses them, encrypts the archive with the existing archive password and retains only the encrypted file as a GitHub Actions artifact. It does not back up Supabase Storage file contents. The existing limits are unchanged: one daily scheduled run at `40 18 * * *` UTC, 1-day artifact retention and a 100 MiB encrypted archive ceiling. GitHub may delay scheduled runs; retention is not a long-term archive.

## Connection configuration

In the Supabase dashboard for project `qjsdglkipgncttztksxl`, open **Connect → Session pooler**. Copy the exact host supplied there; the pooler cluster index cannot be determined from the region. Use the current **database password**, not the Supabase API key, service-role key, JWT secret or personal access token. Percent-encode reserved password characters before inserting the password into a URI.

In the repository's **Settings → Secrets and variables → Actions**, create or update `SUPABASE_POOLER_DB_URL` with the completed connection string. The following is an illustrative shape, not a usable connection string:

```text
postgresql://postgres.qjsdglkipgncttztksxl:<percent-encoded-database-password>@<exact-pooler-host>:5432/postgres?sslmode=require
```

`SUPABASE_POOLER_DB_URL` takes precedence over `SUPABASE_DB_URL`, including if the latter already contains a stale pooler URL. A pooler-only configuration is sufficient. For compatibility, `SUPABASE_DB_URL` can also contain the exact pooler connection string. A direct-only URL no longer causes the workflow to guess a pooler hostname. If an exact transaction-pooler string is supplied, the same configured host and credentials are used on its session-mode port 5432.

Keep `BACKUP_STATUS_TOKEN` matched to the existing production portal's value. Keep `BACKUP_ARCHIVE_PASSWORD` unchanged unless deliberately establishing a new encryption-key lifecycle; older encrypted artifacts need their original archive password. Neither secret belongs in source code or public workflow logs. The archive password's presence can be checked by the workflow; archive integrity still requires a controlled decrypt-and-restore test.

Do not reset the production database password solely to test backups without reviewing all direct database consumers. Supabase API keys and database passwords are different credentials. Updating the backup secret to an already known current password is preferable to a database password reset.

## Verify after repair

Run **Actions → Private daily database backup → Run workflow** on the repair branch before merging, if desired, and then verify on `main`. Confirm all three dumps and encrypted artifact upload succeed, and that the portal receives a `succeeded` outcome with nonzero `archive_bytes` and an `archive_sha256`. Download/decrypt only in an appropriately secured environment; never publish SQL or a decrypted archive. A successful workflow and artifact upload verify creation and retention, not restorability by themselves.

The workflow uses the tested Supabase CLI 3.0.0 release and current `--remote` syntax. The connection URL, decoded password and re-encoded password are registered with GitHub log masking before the selected URL is exported. Partial plaintext dumps are removed on success and failure. Running/failed reports provide no verified database coverage, and the admin system-health API does not mark historical failures as covered.

## Troubleshooting

A failure in **Report backup start** indicates a reporter token, endpoint or server problem. A PostgreSQL authentication error in **Create private logical database archive** indicates database credential rejection or encoding/connection problems. The backend error naming user `postgres` does not alone prove the client omitted the pooler's project-qualified username. Confirm the exact connection secret and current database password before drawing that conclusion.

If Actions-secret operations return `403 Resource not accessible by integration`, repository push/admin access is not sufficient: the GitHub App needs Secrets permission, or an administrator must update the secret in GitHub's web interface. GitHub does not reveal saved secret values. Do not expose existing secrets through diagnostic workflow logs to bypass that restriction.

Local tests: `node scripts/check_backup_workflow_pooler_contract.mjs` runs 21 synthetic connection cases, credential-mask checks and monitoring coverage checks without production credentials. `npm test` runs the existing regression suite. These do not establish that production credentials are valid; only a successful remote run does that.

## References

- [Supabase backup and restore using the CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [Supabase database connection modes and endpoint selection](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase password authentication troubleshooting](https://supabase.com/kb/troubleshooting/fatal-password-authentication-failed)
