output "bucket_name" {
  value = aws_s3_bucket.main.id
}

output "ui_url" {
  value = local.ui_url
}

output "ui_distribution_id" {
  value = aws_cloudfront_distribution.ui.id
}

output "graves_url" {
  value = local.graves_url
}

output "graves_distribution_id" {
  value = aws_cloudfront_distribution.graves.id
}

output "api_url" {
  value = trimsuffix(aws_lambda_function_url.api.function_url, "/")
}
