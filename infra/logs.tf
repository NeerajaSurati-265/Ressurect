resource "aws_cloudwatch_log_group" "builds" {
  name              = local.build_log_group
  retention_in_days = 3
}

resource "aws_cloudwatch_log_group" "api" {
  name              = local.api_log_group
  retention_in_days = 3
}

resource "aws_cloudwatch_log_group" "reaper" {
  name              = local.reaper_log_group
  retention_in_days = 3
}
