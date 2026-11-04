terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"

  default_tags {
    tags = {
      project = "resurrect"
    }
  }
}

data "aws_caller_identity" "current" {}

data "aws_kms_alias" "ssm" {
  name = "alias/aws/ssm"
}

locals {
  account_id  = data.aws_caller_identity.current.account_id
  region      = "us-east-1"
  bucket_name = "resurrect-${local.account_id}"

  ui_url     = "https://${aws_cloudfront_distribution.ui.domain_name}"
  graves_url = "https://${aws_cloudfront_distribution.graves.domain_name}"

  build_log_group  = "/resurrect/builds"
  api_log_group    = "/aws/lambda/resurrect-api"
  reaper_log_group = "/aws/lambda/resurrect-reaper"

  github_token_param = "/resurrect/github-token"
  admin_token_param  = "/resurrect/admin-token"
  schedule_group     = "resurrect"

  package_path = "${path.module}/../build/api.zip"
}
