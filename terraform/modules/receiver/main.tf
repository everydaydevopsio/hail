terraform {
  required_version = ">= 1.7, < 2.0"
  required_providers {
    aws     = { source = "hashicorp/aws", version = ">= 5.50, < 7.0" }
    archive = { source = "hashicorp/archive", version = ">= 2.4, < 3.0" }
  }
}

data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
data "aws_region" "current" {}

locals {
  bucket_name   = coalesce(var.bucket_name, "${var.name}-${data.aws_caller_identity.current.account_id}-${substr(sha256(var.domain), 0, 10)}")
  rule_set_name = var.existing_rule_set_name != null ? var.existing_rule_set_name : "${var.name}-rules"
  rule_name     = "${var.name}-receive"
  rule_arn      = "arn:${data.aws_partition.current.partition}:ses:${var.region}:${data.aws_caller_identity.current.account_id}:receipt-rule-set/${local.rule_set_name}:receipt-rule/${local.rule_name}"
  tags          = merge(var.tags, { ManagedBy = "hail" })
}

resource "aws_s3_bucket" "emails" {
  bucket        = local.bucket_name
  force_destroy = false
  tags          = local.tags
}
resource "aws_s3_bucket_public_access_block" "emails" {
  bucket                  = aws_s3_bucket.emails.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
resource "aws_s3_bucket_server_side_encryption_configuration" "emails" {
  bucket = aws_s3_bucket.emails.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}
# Versioning is intentionally not enabled for short-lived authentication mail.
resource "aws_s3_bucket_lifecycle_configuration" "emails" {
  bucket = aws_s3_bucket.emails.id
  rule {
    id     = "expire-test-mail"
    status = "Enabled"
    filter { prefix = "" }
    expiration { days = var.retention_days }
    noncurrent_version_expiration { noncurrent_days = var.retention_days }
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
  }
}
resource "aws_s3_bucket_policy" "emails" {
  bucket = aws_s3_bucket.emails.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    {
      Sid = "AllowSESWrite", Effect = "Allow", Principal = { Service = "ses.amazonaws.com" },
      Action = "s3:PutObject", Resource = "${aws_s3_bucket.emails.arn}/incoming/*",
      Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id, "aws:SourceArn" = local.rule_arn } }
    },
    {
      Sid = "DenyInsecureTransport", Effect = "Deny", Principal = "*", Action = "s3:*",
      Resource = [aws_s3_bucket.emails.arn, "${aws_s3_bucket.emails.arn}/*"],
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }
  ] })
}
resource "aws_sns_topic" "received" {
  name = "${var.name}-received"
  tags = local.tags
}
resource "aws_sns_topic_policy" "received" {
  arn = aws_sns_topic.received.arn
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Principal = { Service = "ses.amazonaws.com" }, Action = "sns:Publish", Resource = aws_sns_topic.received.arn,
    Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id, "aws:SourceArn" = local.rule_arn } }
  }] })
}
resource "aws_sqs_queue" "dlq" {
  name                      = "${var.name}-ingestion-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
  tags                      = local.tags
}
resource "aws_sqs_queue" "ingestion" {
  name                       = "${var.name}-ingestion"
  visibility_timeout_seconds = 180
  message_retention_seconds  = 259200
  sqs_managed_sse_enabled    = true
  redrive_policy = jsonencode({ deadLetterTargetArn = aws_sqs_queue.dlq.arn, maxReceiveCount = 5 })
  tags = local.tags
}
resource "aws_sqs_queue_policy" "ingestion" {
  queue_url = aws_sqs_queue.ingestion.url
  policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Principal = { Service = "sns.amazonaws.com" }, Action = "sqs:SendMessage", Resource = aws_sqs_queue.ingestion.arn,
    Condition = { ArnEquals = { "aws:SourceArn" = aws_sns_topic.received.arn } }
  }] })
}
resource "aws_sns_topic_subscription" "ingestion" {
  topic_arn            = aws_sns_topic.received.arn
  protocol             = "sqs"
  endpoint             = aws_sqs_queue.ingestion.arn
  raw_message_delivery = true
  depends_on           = [aws_sqs_queue_policy.ingestion]
}
resource "aws_cloudwatch_log_group" "indexer" {
  name              = "/aws/lambda/${var.name}-indexer"
  retention_in_days = 7
  tags              = local.tags
}
resource "aws_iam_role" "indexer" {
  name = "${var.name}-indexer"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole"
  }] })
  tags = local.tags
}
resource "aws_iam_role_policy" "indexer" {
  role = aws_iam_role.indexer.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["s3:GetObject"], Resource = "${aws_s3_bucket.emails.arn}/incoming/*" },
    { Effect = "Allow", Action = ["s3:PutObject"], Resource = "${aws_s3_bucket.emails.arn}/index/*" },
    { Effect = "Allow", Action = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], Resource = aws_sqs_queue.ingestion.arn },
    { Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = "${aws_cloudwatch_log_group.indexer.arn}:*" }
  ] })
}
data "archive_file" "indexer" {
  type        = "zip"
  source_file = "${path.module}/lambda/handler.py"
  output_path = "${path.module}/lambda.zip"
}
resource "aws_lambda_function" "indexer" {
  function_name    = "${var.name}-indexer"
  role             = aws_iam_role.indexer.arn
  runtime          = "python3.12"
  handler          = "handler.handler"
  filename         = data.archive_file.indexer.output_path
  source_code_hash = data.archive_file.indexer.output_base64sha256
  timeout          = 30
  memory_size      = 128
  environment {
    variables = { BUCKET = aws_s3_bucket.emails.id, DOMAIN = var.domain }
  }
  depends_on = [aws_iam_role_policy.indexer, aws_cloudwatch_log_group.indexer]
  tags       = local.tags
}
resource "aws_lambda_event_source_mapping" "ingestion" {
  event_source_arn        = aws_sqs_queue.ingestion.arn
  function_name          = aws_lambda_function.indexer.arn
  batch_size             = 10
  function_response_types = ["ReportBatchItemFailures"]
  depends_on             = [aws_iam_role_policy.indexer]
}
resource "aws_ses_domain_identity" "receiver" {
  domain = var.domain
  lifecycle {
    precondition {
      condition     = data.aws_region.current.name == var.region
      error_message = "The AWS provider and receiver must use the same region."
    }
    precondition {
      condition     = !(var.manage_rule_set_activation && var.existing_rule_set_name != null)
      error_message = "Do not manage activation of an existing/shared receipt rule set."
    }
  }
}
resource "aws_ses_receipt_rule_set" "receiver" {
  count         = var.existing_rule_set_name == null ? 1 : 0
  rule_set_name = local.rule_set_name
}
resource "aws_ses_receipt_rule" "receiver" {
  name          = local.rule_name
  rule_set_name = local.rule_set_name
  enabled       = true
  recipients    = [var.domain]
  scan_enabled  = true
  tls_policy    = "Optional"
  s3_action {
    position          = 1
    bucket_name       = aws_s3_bucket.emails.id
    object_key_prefix = "incoming/"
    topic_arn         = aws_sns_topic.received.arn
  }
  depends_on = [aws_ses_receipt_rule_set.receiver, aws_s3_bucket_policy.emails, aws_sns_topic_policy.received, aws_sns_topic_subscription.ingestion, aws_lambda_event_source_mapping.ingestion]
}
resource "aws_ses_active_receipt_rule_set" "receiver" {
  count         = var.manage_rule_set_activation ? 1 : 0
  rule_set_name = local.rule_set_name
  depends_on    = [aws_ses_receipt_rule.receiver]
}
resource "aws_iam_policy" "reader" {
  name = "${var.name}-reader"
  policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Effect = "Allow", Action = ["s3:ListBucket"], Resource = aws_s3_bucket.emails.arn, Condition = { StringLike = { "s3:prefix" = ["index/*"] } } },
    { Effect = "Allow", Action = ["s3:GetObject"], Resource = ["${aws_s3_bucket.emails.arn}/index/*", "${aws_s3_bucket.emails.arn}/incoming/*"] },
    { Effect = "Allow", Action = ["ses:GetIdentityVerificationAttributes", "ses:DescribeActiveReceiptRuleSet"], Resource = "*" }
  ] })
  tags = local.tags
}
resource "aws_iam_role" "reader" {
  count = length(var.reader_principal_arns) > 0 ? 1 : 0
  name  = "${var.name}-reader"
  assume_role_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Principal = { AWS = var.reader_principal_arns }, Action = "sts:AssumeRole"
  }] })
  tags = local.tags
}
resource "aws_iam_role_policy_attachment" "reader" {
  count      = length(var.reader_principal_arns) > 0 ? 1 : 0
  role       = aws_iam_role.reader[0].name
  policy_arn = aws_iam_policy.reader.arn
}
