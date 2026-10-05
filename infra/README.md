# infra

Terraform for the hosted machine on Vultr: one instance (`vhp-4c-8gb-amd` in `icn`, Ubuntu 24.04), a reserved IPv4
address, a firewall group (22 from the owner's address, 80 and 443 from Cloudflare's IPv4 ranges) and the owner's SSH
key. `/data` lives on the instance's own disk. On first boot `cloud-init.yaml.tftpl` installs Docker from Docker's
repository, writes `/etc/hazelle/` (the env file, the rclone config for R2, both compose files, the Caddyfile, the
copier script, the Origin CA pair) and runs `hazelle-compose up -d`.

## Inputs

The API key is read by the provider from `VULTR_API_KEY` in the shell; it is in no file. Everything else is a
variable (`variables.tf`), passed as `-var` or `TF_VAR_*`, or in a `*.tfvars` file, which git ignores:

| variable | what |
|---|---|
| `ssh_public_key` | the owner's SSH public key |
| `owner_cidr` | the owner's IPv4 address as `a.b.c.d/32`; the only source allowed on port 22 |
| `image_digest` | `sha256:…` of the release to start with (the release notes record it) |
| `origin_cert_file`, `origin_key_file` | paths to the Cloudflare Origin CA certificate and key for `hazelle.app` |
| `r2_account_id`, `r2_access_key_id`, `r2_secret_access_key`, `r2_bucket` | the off-site backup bucket and a key that may read, write and delete in it |
| `alert_webhook` | optional Discord/Slack webhook for backup and disk alerts |
| `cloudflare_ipv4` | defaults to Cloudflare's published list; update it when https://www.cloudflare.com/ips-v4 changes |

The R2 keys, the origin key and the webhook end up in the instance's user data, in the state file and on the machine
under `/etc/hazelle` (mode 0600). Anything on the instance can read its user data from the metadata service; the app's
outbound policy refuses link-local addresses, so a bot cannot reach it through the app.

## Commands

```
cd infra
terraform init
terraform apply      # creates the machine; prints ip
```

`image_digest` and the files embedded in the user data matter on first boot only: the instance ignores later changes
to `user_data`, and `scripts/deploy.sh <tag>` is the only path that changes the running image. A change to a compose
file or the copier reaches a running machine by copying it to `/etc/hazelle/` and `hazelle-compose up -d`, or by a
rebuilt machine.

The copier (`deploy/rclone-backup.sh`) must be the only writer under its remote prefix. It deletes a pooled picture
only when no manifest in the remote's listing names it and the machine's own pool no longer holds it, which assumes a
listing never lags behind by the 7 days the machine keeps a generation.

`prevent_destroy` is set on the instance and the reserved IP, so a plain `terraform destroy` fails. `scripts/destroy.sh`
removes them only after it has restored the newest off-site generation into a scratch directory; it lifts the guard
by writing `destroy_override.tf` for the length of its run.

## State

State is local (`terraform.tfstate`, git-ignored) and holds the secrets above. Keep a copy somewhere private. Losing
it loses nothing on Vultr, but Terraform no longer knows the machine: a new `apply` would try to create a second one.
To take the existing resources back, import each by its Vultr id (shown by the Vultr API or `vultr-cli`):

```
terraform import vultr_ssh_key.owner <ssh-key-id>
terraform import vultr_firewall_group.hazelle <firewall-group-id>
terraform import vultr_firewall_rule.ssh <firewall-group-id>,<rule-id>
terraform import 'vultr_firewall_rule.web["173.245.48.0/20 443"]' <firewall-group-id>,<rule-id>   # one per rule
terraform import vultr_reserved_ip.hazelle <reserved-ip-id>
terraform import vultr_instance.hazelle <instance-id>
```

Then `terraform plan` must show no change to the instance before anything is applied.
