data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

# ---------------------------------------------------------------- API Lambda

resource "aws_iam_role" "api" {
  name               = "resurrect-api"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "api" {
  statement {
    sid       = "Records"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem", "dynamodb:Query"]
    resources = [aws_dynamodb_table.records.arn]
  }

  statement {
    sid       = "Builds"
    actions   = ["codebuild:StartBuild", "codebuild:BatchGetBuilds"]
    resources = [aws_codebuild_project.build.arn]
  }

  statement {
    sid       = "ReadBuildLogs"
    actions   = ["logs:GetLogEvents"]
    resources = [aws_cloudwatch_log_group.builds.arn, "${aws_cloudwatch_log_group.builds.arn}:*"]
  }

  # The Converse API is authorised by bedrock:InvokeModel. Cross-region
  # inference profiles (us.*) need the foundation models in every region.
  statement {
    sid     = "Bedrock"
    actions = ["bedrock:InvokeModel"]
    resources = [
      "arn:aws:bedrock:*::foundation-model/*",
      "arn:aws:bedrock:${local.region}:${local.account_id}:inference-profile/*",
    ]
  }

  statement {
    sid     = "Secrets"
    actions = ["ssm:GetParameter"]
    resources = [
      "arn:aws:ssm:${local.region}:${local.account_id}:parameter${local.github_token_param}",
      "arn:aws:ssm:${local.region}:${local.account_id}:parameter${local.admin_token_param}",
    ]
  }

  statement {
    sid       = "DecryptSecrets"
    actions   = ["kms:Decrypt"]
    resources = [data.aws_kms_alias.ssm.target_key_arn]
  }

  statement {
    sid       = "ReapSchedules"
    actions   = ["scheduler:CreateSchedule", "scheduler:DeleteSchedule"]
    resources = ["arn:aws:scheduler:${local.region}:${local.account_id}:schedule/${local.schedule_group}/*"]
  }

  statement {
    sid       = "PassSchedulerRole"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.scheduler.arn]
  }

  statement {
    sid       = "InvalidateGraves"
    actions   = ["cloudfront:CreateInvalidation"]
    resources = [aws_cloudfront_distribution.graves.arn]
  }

  statement {
    sid       = "OwnLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = [aws_cloudwatch_log_group.api.arn, "${aws_cloudwatch_log_group.api.arn}:*"]
  }
}

resource "aws_iam_role_policy" "api" {
  name   = "resurrect-api"
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api.json
}

resource "aws_lambda_function" "api" {
  function_name    = "resurrect-api"
  role             = aws_iam_role.api.arn
  runtime          = "python3.12"
  architectures    = ["x86_64"]
  handler          = "app.main.handler"
  memory_size      = 512
  timeout          = 30
  filename         = local.package_path
  source_code_hash = filebase64sha256(local.package_path)

  environment {
    variables = {
      TABLE_NAME             = aws_dynamodb_table.records.name
      BUCKET                 = aws_s3_bucket.main.id
      UI_URL                 = local.ui_url
      GRAVES_URL             = local.graves_url
      GRAVES_DISTRIBUTION_ID = aws_cloudfront_distribution.graves.id
      CODEBUILD_PROJECT      = aws_codebuild_project.build.name
      LOG_GROUP              = aws_cloudwatch_log_group.builds.name
      GITHUB_TOKEN_PARAM     = local.github_token_param
      ADMIN_TOKEN_PARAM      = local.admin_token_param
      BEDROCK_MODEL_ID       = var.bedrock_model_id
      RESURRECTIONS_ENABLED  = tostring(var.resurrections_enabled)
      IP_LIMIT_PER_HOUR      = "3"
      DAILY_BUILD_QUOTA      = "50"
      LIFETIME_MINUTES       = tostring(var.lifetime_minutes)
      REAPER_ARN             = aws_lambda_function.reaper.arn
      SCHEDULER_ROLE_ARN     = aws_iam_role.scheduler.arn
      SCHEDULE_GROUP         = local.schedule_group
    }
  }

  depends_on = [aws_cloudwatch_log_group.api, aws_iam_role_policy.api]
}

resource "aws_lambda_function_url" "api" {
  function_name      = aws_lambda_function.api.function_name
  authorization_type = "NONE"

  cors {
    allow_origins = [local.ui_url, "http://localhost:5173"]
    allow_methods = ["GET", "POST"]
    allow_headers = ["content-type", "x-resurrect-admin"]
    max_age       = 3600
  }
}

# A public Function URL needs both permissions.
resource "aws_lambda_permission" "api_url" {
  statement_id           = "AllowPublicFunctionUrl"
  action                 = "lambda:InvokeFunctionUrl"
  function_name          = aws_lambda_function.api.function_name
  principal              = "*"
  function_url_auth_type = "NONE"
}

resource "aws_lambda_permission" "api_invoke" {
  statement_id             = "AllowPublicInvokeViaUrl"
  action                   = "lambda:InvokeFunction"
  function_name            = aws_lambda_function.api.function_name
  principal                = "*"
  invoked_via_function_url = true
}

# -------------------------------------------------------------- Reaper Lambda

resource "aws_iam_role" "reaper" {
  name               = "resurrect-reaper"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

data "aws_iam_policy_document" "reaper" {
  statement {
    sid       = "ListGraves"
    actions   = ["s3:ListBucket"]
    resources = [aws_s3_bucket.main.arn]
    condition {
      test     = "StringLike"
      variable = "s3:prefix"
      values   = ["graves/r-*"]
    }
  }

  statement {
    sid       = "DeleteGraves"
    actions   = ["s3:DeleteObject"]
    resources = ["${aws_s3_bucket.main.arn}/graves/r-*"]
  }

  statement {
    # Records are one JSON document, so expiring one is a read plus a version-conditional write.
    sid       = "MarkExpired"
    actions   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:UpdateItem"]
    resources = [aws_dynamodb_table.records.arn]
  }

  statement {
    sid       = "InvalidateGraves"
    actions   = ["cloudfront:CreateInvalidation"]
    resources = [aws_cloudfront_distribution.graves.arn]
  }

  statement {
    sid       = "OwnLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = [aws_cloudwatch_log_group.reaper.arn, "${aws_cloudwatch_log_group.reaper.arn}:*"]
  }
}

resource "aws_iam_role_policy" "reaper" {
  name   = "resurrect-reaper"
  role   = aws_iam_role.reaper.id
  policy = data.aws_iam_policy_document.reaper.json
}

resource "aws_lambda_function" "reaper" {
  function_name    = "resurrect-reaper"
  role             = aws_iam_role.reaper.arn
  runtime          = "python3.12"
  architectures    = ["x86_64"]
  handler          = "app.reaper.handler"
  memory_size      = 256
  timeout          = 60
  filename         = local.package_path
  source_code_hash = filebase64sha256(local.package_path)

  # Not in the B1 list; the reaper needs these to do its job.
  environment {
    variables = {
      TABLE_NAME             = aws_dynamodb_table.records.name
      BUCKET                 = aws_s3_bucket.main.id
      GRAVES_DISTRIBUTION_ID = aws_cloudfront_distribution.graves.id
    }
  }

  depends_on = [aws_cloudwatch_log_group.reaper, aws_iam_role_policy.reaper]
}
