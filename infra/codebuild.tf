data "aws_iam_policy_document" "codebuild_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["codebuild.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "codebuild" {
  name               = "resurrect-codebuild"
  assume_role_policy = data.aws_iam_policy_document.codebuild_assume.json
}

data "aws_iam_policy_document" "codebuild" {
  statement {
    sid       = "WriteGraves"
    actions   = ["s3:PutObject", "s3:DeleteObject"]
    resources = ["${aws_s3_bucket.main.arn}/graves/r-*"]
  }

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
    sid       = "BuildLogs"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.builds.arn}", "${aws_cloudwatch_log_group.builds.arn}:*"]
  }
}

resource "aws_iam_role_policy" "codebuild" {
  name   = "resurrect-codebuild"
  role   = aws_iam_role.codebuild.id
  policy = data.aws_iam_policy_document.codebuild.json
}

resource "aws_codebuild_project" "build" {
  name           = "resurrect-build"
  description    = "Clones and builds a student repo, uploads to graves/<id>/"
  service_role   = aws_iam_role.codebuild.arn
  build_timeout  = 10
  queued_timeout = 10

  artifacts {
    type = "NO_ARTIFACTS"
  }

  environment {
    compute_type = "BUILD_GENERAL1_SMALL"
    image        = "aws/codebuild/standard:7.0"
    type         = "LINUX_CONTAINER"
  }

  source {
    type      = "NO_SOURCE"
    buildspec = file("${path.module}/../buildspec/static-react.yml")
  }

  logs_config {
    cloudwatch_logs {
      status     = "ENABLED"
      group_name = aws_cloudwatch_log_group.builds.name
    }
  }

  depends_on = [aws_iam_role_policy.codebuild]
}
