resource "aws_cloudfront_origin_access_control" "main" {
  name                              = "resurrect-oac"
  description                       = "Resurrect S3 access"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

data "aws_cloudfront_cache_policy" "optimized" {
  name = "Managed-CachingOptimized"
}

# Graves cache policy: short cache so deleted sites disappear quickly.
resource "aws_cloudfront_cache_policy" "graves" {
  name        = "resurrect-graves-short"
  min_ttl     = 0
  default_ttl = 60
  max_ttl     = 60

  parameters_in_cache_key_and_forwarded_to_origin {
    enable_accept_encoding_gzip   = true
    enable_accept_encoding_brotli = true

    cookies_config {
      cookie_behavior = "none"
    }
    headers_config {
      header_behavior = "none"
    }
    query_strings_config {
      query_string_behavior = "none"
    }
  }
}

resource "aws_cloudfront_function" "index_rewrite" {
  name    = "resurrect-index-rewrite"
  runtime = "cloudfront-js-2.0"
  comment = "Append index.html to folder-style URIs"
  publish = true
  code    = file("${path.module}/cf_index_rewrite.js")
}

resource "aws_cloudfront_distribution" "ui" {
  comment             = "resurrect-ui"
  enabled             = true
  default_root_object = "index.html"
  price_class         = "PriceClass_100"
  http_version        = "http2"

  origin {
    origin_id                = "s3-ui"
    domain_name              = aws_s3_bucket.main.bucket_regional_domain_name
    origin_path              = "/ui"
    origin_access_control_id = aws_cloudfront_origin_access_control.main.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-ui"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = data.aws_cloudfront_cache_policy.optimized.id
  }

  # SPA fallback: unknown paths return the app shell.
  custom_error_response {
    error_code         = 403
    response_code      = 200
    response_page_path = "/index.html"
  }

  custom_error_response {
    error_code         = 404
    response_code      = 200
    response_page_path = "/index.html"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}

resource "aws_cloudfront_distribution" "graves" {
  comment      = "resurrect-graves"
  enabled      = true
  price_class  = "PriceClass_100"
  http_version = "http2"

  origin {
    origin_id                = "s3-graves"
    domain_name              = aws_s3_bucket.main.bucket_regional_domain_name
    origin_path              = "/graves"
    origin_access_control_id = aws_cloudfront_origin_access_control.main.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-graves"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = aws_cloudfront_cache_policy.graves.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.index_rewrite.arn
    }
  }

  # Dead links show the tombstone page with a real 404.
  custom_error_response {
    error_code            = 403
    response_code         = 404
    response_page_path    = "/_rip/index.html"
    error_caching_min_ttl = 0
  }

  custom_error_response {
    error_code            = 404
    response_code         = 404
    response_page_path    = "/_rip/index.html"
    error_caching_min_ttl = 0
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    cloudfront_default_certificate = true
  }
}
