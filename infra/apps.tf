# B4: backend apps (FastAPI, Flask, Django, Express, Fastify) as Lambda container images.
# Nothing here is used unless BACKENDS_ENABLED=true on the API Lambda.

locals {
  apps_function_arn = "arn:aws:lambda:${local.region}:${local.account_id}:function:rz-*"
  apps_log_arn      = "arn:aws:logs:${local.region}:${local.account_id}:log-group:/aws/lambda/rz-*"
}

# ------------------------------------------------------------------ ECR

resource "aws_ecr_repository" "apps" {
  name                 = "resurrect-apps"
  image_tag_mutability = "MUTABLE"
  force_delete         = true

  image_scanning_configuration {
    scan_on_push = false
  }
}

resource "aws_ecr_lifecycle_policy" "apps" {
  repository = aws_ecr_repository.apps.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Expire images older than 2 days (safety net; the reaper deletes them sooner)"
      selection = {
        tagStatus   = "any"
        countType   = "sinceImagePushed"
        countUnit   = "days"
        countNumber = 2
      }
      action = { type = "expire" }
    }]
  })
}

data "aws_iam_policy_document" "apps_repo" {
  statement {
    sid    = "LambdaPullsRzImages"
    effect = "Allow"
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
    actions = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"]
    condition {
      test     = "ArnLike"
      variable = "aws:sourceArn"
      values   = [local.apps_function_arn]
    }
  }
}

resource "aws_ecr_repository_policy" "apps" {
  repository = aws_ecr_repository.apps.name
  policy     = data.aws_iam_policy_document.apps_repo.json
}

# ------------------------------------------- Execution role for student code

data "aws_iam_policy_document" "app_exec" {
  statement {
    sid       = "OwnLogsOnly"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = [local.apps_log_arn, "${local.apps_log_arn}:*"]
  }
}

resource "aws_iam_role" "app_exec" {
  name               = "resurrect-app-exec"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

# Student code runs with this role: logs only. No S3, no DynamoDB, nothing else.
resource "aws_iam_role_policy" "app_exec" {
  name   = "resurrect-app-exec"
  role   = aws_iam_role.app_exec.id
  policy = data.aws_iam_policy_document.app_exec.json
}

# ------------------------------------------- Separate CodeBuild project (privileged)

resource "aws_iam_role" "codebuild_apps" {
  name               = "resurrect-codebuild-apps"
  assume_role_policy = data.aws_iam_policy_document.codebuild_assume.json
}

data "aws_iam_policy_document" "codebuild_apps" {
  statement {
    sid       = "EcrLogin"
    actions   = ["ecr:GetAuthorizationToken"]
    resources = ["*"]
  }

  statement {
    sid = "PushApps"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:InitiateLayerUpload",
      "ecr:UploadLayerPart",
      "ecr:CompleteLayerUpload",
      "ecr:PutImage",
    ]
    resources = [aws_ecr_repository.apps.arn]
  }

  statement {
    sid       = "BuildLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = [aws_cloudwatch_log_group.builds.arn, "${aws_cloudwatch_log_group.builds.arn}:*"]
  }
}

resource "aws_iam_role_policy" "codebuild_apps" {
  name   = "resurrect-codebuild-apps"
  role   = aws_iam_role.codebuild_apps.id
  policy = data.aws_iam_policy_document.codebuild_apps.json
}

resource "aws_codebuild_project" "build_apps" {
  name           = "resurrect-build-apps"
  description    = "Builds a backend repo into a container image and pushes it to ECR"
  service_role   = aws_iam_role.codebuild_apps.arn
  build_timeout  = 10
  queued_timeout = 10

  artifacts {
    type = "NO_ARTIFACTS"
  }

  environment {
    compute_type    = "BUILD_GENERAL1_SMALL"
    image           = "aws/codebuild/standard:7.0"
    type            = "LINUX_CONTAINER"
    privileged_mode = true

    environment_variable {
      name  = "ECR_APPS_URI"
      value = aws_ecr_repository.apps.repository_url
    }
  }

  source {
    type      = "NO_SOURCE"
    buildspec = file("${path.module}/../buildspec/backend-container.yml")
  }

  logs_config {
    cloudwatch_logs {
      status     = "ENABLED"
      group_name = aws_cloudwatch_log_group.builds.name
    }
  }

  depends_on = [aws_iam_role_policy.codebuild_apps]
}

# ------------------------------------------- API Lambda additions

data "aws_iam_policy_document" "api_apps" {
  statement {
    sid = "ManageRzFunctions"
    actions = [
      "lambda:CreateFunction",
      "lambda:GetFunction",
      "lambda:DeleteFunction",
      "lambda:CreateFunctionUrlConfig",
      "lambda:GetFunctionUrlConfig",
      "lambda:DeleteFunctionUrlConfig",
      "lambda:AddPermission",
      "lambda:TagResource",
    ]
    resources = [local.apps_function_arn]
  }

  # Needed to count live backends for the MAX_LIVE_BACKENDS cap. ListFunctions cannot be
  # scoped to a resource; the API only reads names and filters on the rz- prefix.
  statement {
    sid       = "CountRzFunctions"
    actions   = ["lambda:ListFunctions"]
    resources = ["*"]
  }

  statement {
    sid       = "PassAppExecRole"
    actions   = ["iam:PassRole"]
    resources = [aws_iam_role.app_exec.arn]
    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["lambda.amazonaws.com"]
    }
  }

  # A failed backend is cleaned up straight away so it does not hold one of the live slots.
  statement {
    sid       = "CleanUpFailedApps"
    actions   = ["ecr:BatchDeleteImage"]
    resources = [aws_ecr_repository.apps.arn]
  }

  statement {
    sid       = "DeleteFailedAppLogs"
    actions   = ["logs:DeleteLogGroup"]
    resources = [local.apps_log_arn, "${local.apps_log_arn}:*"]
  }

  statement {
    sid       = "ReadAppImages"
    actions   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:DescribeImages"]
    resources = [aws_ecr_repository.apps.arn]
  }

  statement {
    sid       = "AppLogGroups"
    actions   = ["logs:CreateLogGroup", "logs:PutRetentionPolicy"]
    resources = [local.apps_log_arn, "${local.apps_log_arn}:*"]
  }

  statement {
    sid       = "ReadAppLogs"
    actions   = ["logs:GetLogEvents", "logs:FilterLogEvents"]
    resources = [local.apps_log_arn, "${local.apps_log_arn}:*"]
  }

  statement {
    sid       = "StartAppBuilds"
    actions   = ["codebuild:StartBuild", "codebuild:BatchGetBuilds"]
    resources = [aws_codebuild_project.build_apps.arn]
  }

  statement {
    sid       = "ReadAppBuildLogs"
    actions   = ["logs:GetLogEvents"]
    resources = [aws_cloudwatch_log_group.builds.arn, "${aws_cloudwatch_log_group.builds.arn}:*"]
  }
}

resource "aws_iam_role_policy" "api_apps" {
  name   = "resurrect-api-apps"
  role   = aws_iam_role.api.id
  policy = data.aws_iam_policy_document.api_apps.json
}

# ------------------------------------------- Reaper additions

data "aws_iam_policy_document" "reaper_apps" {
  statement {
    sid       = "DeleteRzFunctions"
    actions   = ["lambda:DeleteFunction", "lambda:GetFunction"]
    resources = [local.apps_function_arn]
  }

  statement {
    sid       = "DeleteAppImages"
    actions   = ["ecr:BatchDeleteImage"]
    resources = [aws_ecr_repository.apps.arn]
  }

  statement {
    sid       = "DeleteAppLogGroups"
    actions   = ["logs:DeleteLogGroup"]
    resources = [local.apps_log_arn, "${local.apps_log_arn}:*"]
  }
}

resource "aws_iam_role_policy" "reaper_apps" {
  name   = "resurrect-reaper-apps"
  role   = aws_iam_role.reaper.id
  policy = data.aws_iam_policy_document.reaper_apps.json
}
