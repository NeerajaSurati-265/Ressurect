# Resurrect infrastructure (us-east-1)

Terraform for the whole AWS side. State is local (`infra/terraform.tfstate`, never committed).
The CLI default region may differ, so export it first:

```bash
export AWS_REGION=us-east-1 AWS_DEFAULT_REGION=us-east-1
```

## Apply

Package the Lambda zip first. Terraform hashes `build/api.zip`, so it must exist.

```bash
scripts/package_backend.sh        # from the repo root; writes build/api.zip
cd infra
terraform init
terraform plan
terraform apply
terraform output -json > outputs.json   # no secrets in it
```

Code changes: re-run `scripts/package_backend.sh`, then `terraform apply`. The `source_code_hash` makes both Lambdas redeploy.
CloudFront distributions take 5-15 minutes to reach `Deployed`.

## Secrets (SSM Parameter Store, created by CLI, never in Terraform or git)

Rotate by overwriting the value; Lambdas read the parameters at runtime, so restart is not needed
beyond a cold start (wait a few minutes or redeploy to be sure).

```bash
aws ssm put-parameter --region us-east-1 --name /resurrect/github-token --type SecureString --overwrite --value '<new token>'
aws ssm put-parameter --region us-east-1 --name /resurrect/admin-token  --type SecureString --overwrite --value '<new token>'
```

## Kill switch

Stop all new resurrections (POST and retry return 503 `resurrections_disabled`):

```bash
cd infra && terraform apply -var resurrections_enabled=false
```

Turn back on with `-var resurrections_enabled=true`. In an emergency, edit the `RESURRECTIONS_ENABLED`
environment variable on the `resurrect-api` Lambda in the console (Terraform will reset it on the next apply).
