terraform {
  required_version = ">= 1.7, < 2.0"
  required_providers {
    aws = { source = "hashicorp/aws", version = ">= 5.50, < 7.0" }
  }
}

provider "aws" { region = var.region }
data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}
data "aws_region" "current" {}

locals {
  partition  = data.aws_partition.current.partition
  bucket     = "${var.name}-${var.account_id}-${substr(sha256(var.domain), 0, 10)}"
  bucket_arn = "arn:${local.partition}:s3:::${local.bucket}"
  topic_arn  = "arn:${local.partition}:sns:${var.region}:${var.account_id}:${var.name}-received"
  queue_arns = [
    "arn:${local.partition}:sqs:${var.region}:${var.account_id}:${var.name}-ingestion",
    "arn:${local.partition}:sqs:${var.region}:${var.account_id}:${var.name}-ingestion-dlq",
  ]
  function_arn    = "arn:${local.partition}:lambda:${var.region}:${var.account_id}:function:${var.name}-indexer"
  mapping_arn     = "arn:${local.partition}:lambda:${var.region}:${var.account_id}:event-source-mapping:*"
  log_group_arn   = "arn:${local.partition}:logs:${var.region}:${var.account_id}:log-group:/aws/lambda/${var.name}-indexer"
  log_stream_arn  = "${local.log_group_arn}:log-stream:*"
  identity_arn    = "arn:${local.partition}:ses:${var.region}:${var.account_id}:identity/${var.domain}"
  provisioner_arn = "arn:${local.partition}:iam::${var.account_id}:role/${var.name}-provisioner"
  policy_arns = {
    provisioner = "arn:${local.partition}:iam::${var.account_id}:policy/${var.name}-provisioner"
    reader      = "arn:${local.partition}:iam::${var.account_id}:policy/${var.name}-reader"
    sender      = "arn:${local.partition}:iam::${var.account_id}:policy/${var.name}-sender"
    indexer     = "arn:${local.partition}:iam::${var.account_id}:policy/${var.name}-indexer"
  }
  tags = {
    Project     = "hail"
    Environment = "test"
    RunId       = var.name
    Owner       = var.owner
    ExpiresAt   = var.expires_at
  }
  source_trust = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Principal = { AWS = var.source_principal_arn }, Action = "sts:AssumeRole"
  }] })
  reader_trust = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Principal = { AWS = [var.source_principal_arn, local.provisioner_arn] }, Action = "sts:AssumeRole"
  }] })
  indexer_trust = jsonencode({ Version = "2012-10-17", Statement = [{
    Effect = "Allow", Principal = { Service = "lambda.amazonaws.com" }, Action = "sts:AssumeRole"
  }] })
  reader_policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Sid = "ListIndexes", Effect = "Allow", Action = ["s3:ListBucket"], Resource = local.bucket_arn, Condition = { StringLike = { "s3:prefix" = ["index/*"] } } },
    { Sid = "ReadMail", Effect = "Allow", Action = ["s3:GetObject"], Resource = ["${local.bucket_arn}/index/*", "${local.bucket_arn}/incoming/*"] },
    { Sid = "ReadSesDiagnostics", Effect = "Allow", Action = ["ses:GetIdentityVerificationAttributes", "ses:DescribeActiveReceiptRuleSet"], Resource = "*", Condition = { StringEquals = { "aws:RequestedRegion" = var.region } } },
  ] })
  sender_policy = jsonencode({ Version = "2012-10-17", Statement = [{
    Sid = "SyntheticSend", Effect = "Allow", Action = ["ses:SendRawEmail"], Resource = local.identity_arn,
    Condition = {
      StringEquals              = { "ses:FromAddress" = var.from_address, "aws:RequestedRegion" = var.region },
      "ForAllValues:StringLike" = { "ses:Recipients" = ["*@${var.domain}"] },
      Null                      = { "ses:Recipients" = "false" },
    }
  }] })
  indexer_policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Sid = "ReadRaw", Effect = "Allow", Action = ["s3:GetObject"], Resource = "${local.bucket_arn}/incoming/*" },
    { Sid = "WriteIndexes", Effect = "Allow", Action = ["s3:PutObject"], Resource = "${local.bucket_arn}/index/*" },
    { Sid = "ConsumeIngestion", Effect = "Allow", Action = ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"], Resource = local.queue_arns[0] },
    { Sid = "WriteOwnLogs", Effect = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"], Resource = local.log_stream_arn },
  ] })
  provisioner_policy = jsonencode({ Version = "2012-10-17", Statement = [
    { Sid = "PassIndexerOnly", Effect = "Allow", Action = ["iam:PassRole"], Resource = "arn:${local.partition}:iam::${var.account_id}:role/${var.name}-indexer", Condition = { StringEquals = { "iam:PassedToService" = "lambda.amazonaws.com" } } },
    { Sid = "AssumeReaderOnly", Effect = "Allow", Action = ["sts:AssumeRole"], Resource = "arn:${local.partition}:iam::${var.account_id}:role/${var.name}-reader" },
    { Sid = "OwnBucket", Effect = "Allow", Action = ["s3:CreateBucket", "s3:DeleteBucket", "s3:ListBucket", "s3:ListBucketVersions", "s3:GetBucketLocation", "s3:GetBucketAcl", "s3:GetBucketCORS", "s3:GetBucketWebsite", "s3:GetAccelerateConfiguration", "s3:GetBucketRequestPayment", "s3:GetBucketLogging", "s3:GetReplicationConfiguration", "s3:GetBucketObjectLockConfiguration", "s3:GetBucketPolicy", "s3:PutBucketPolicy", "s3:DeleteBucketPolicy", "s3:GetBucketPublicAccessBlock", "s3:PutBucketPublicAccessBlock", "s3:GetEncryptionConfiguration", "s3:PutEncryptionConfiguration", "s3:GetLifecycleConfiguration", "s3:PutLifecycleConfiguration", "s3:GetBucketTagging", "s3:PutBucketTagging", "s3:GetBucketVersioning"], Resource = local.bucket_arn },
    { Sid = "OwnObjects", Effect = "Allow", Action = ["s3:GetObject", "s3:DeleteObject", "s3:DeleteObjectVersion"], Resource = "${local.bucket_arn}/*" },
    { Sid = "OwnTopic", Effect = "Allow", Action = ["sns:CreateTopic", "sns:DeleteTopic", "sns:GetTopicAttributes", "sns:SetTopicAttributes", "sns:GetSubscriptionAttributes", "sns:SetSubscriptionAttributes", "sns:TagResource", "sns:UntagResource", "sns:ListTagsForResource", "sns:Subscribe", "sns:ListSubscriptionsByTopic"], Resource = local.topic_arn },
    { Sid = "OwnQueues", Effect = "Allow", Action = ["sqs:CreateQueue", "sqs:DeleteQueue", "sqs:GetQueueAttributes", "sqs:GetQueueUrl", "sqs:SetQueueAttributes", "sqs:ListQueueTags", "sqs:TagQueue", "sqs:UntagQueue", "sqs:SendMessage", "sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:ChangeMessageVisibility"], Resource = local.queue_arns },
    { Sid = "OwnFunction", Effect = "Allow", Action = ["lambda:CreateFunction", "lambda:GetFunction", "lambda:GetFunctionConfiguration", "lambda:GetFunctionCodeSigningConfig", "lambda:ListVersionsByFunction", "lambda:UpdateFunctionCode", "lambda:UpdateFunctionConfiguration", "lambda:DeleteFunction", "lambda:TagResource", "lambda:UntagResource", "lambda:ListTags"], Resource = local.function_arn },
    { Sid = "CreateOwnMapping", Effect = "Allow", Action = ["lambda:CreateEventSourceMapping"], Resource = "*", Condition = { ArnEquals = { "lambda:FunctionArn" = local.function_arn }, StringEquals = { "aws:RequestedRegion" = var.region } } },
    { Sid = "ManageOwnMapping", Effect = "Allow", Action = ["lambda:UpdateEventSourceMapping", "lambda:DeleteEventSourceMapping"], Resource = local.mapping_arn, Condition = { ArnEquals = { "lambda:FunctionArn" = local.function_arn } } },
    # AWS authorizes GetEventSourceMapping against * while a deleted mapping disappears;
    # Terraform polls this API after DeleteEventSourceMapping returns.
    { Sid = "ReadRegionalMapping", Effect = "Allow", Action = ["lambda:GetEventSourceMapping"], Resource = "*", Condition = { StringEquals = { "aws:RequestedRegion" = var.region } } },
    { Sid = "ReadMappingTags", Effect = "Allow", Action = ["lambda:ListTags"], Resource = local.mapping_arn, Condition = { StringEquals = { "aws:RequestedRegion" = var.region } } },
    { Sid = "ListOwnMappings", Effect = "Allow", Action = ["lambda:ListEventSourceMappings"], Resource = "*", Condition = { StringEquals = { "aws:RequestedRegion" = var.region } } },
    { Sid = "OwnLogGroup", Effect = "Allow", Action = ["logs:CreateLogGroup", "logs:DeleteLogGroup", "logs:PutRetentionPolicy", "logs:DescribeLogStreams", "logs:FilterLogEvents", "logs:TagResource", "logs:ListTagsForResource"], Resource = local.log_group_arn },
    { Sid = "ReadOwnLogStreams", Effect = "Allow", Action = ["logs:GetLogEvents"], Resource = local.log_stream_arn },
    { Sid = "DescribeRegionalLogs", Effect = "Allow", Action = ["logs:DescribeLogGroups"], Resource = "*", Condition = { StringEquals = { "aws:RequestedRegion" = var.region } } },
    { Sid = "OwnSesRegion", Effect = "Allow", Action = ["ses:VerifyDomainIdentity", "ses:DeleteIdentity", "ses:GetIdentityVerificationAttributes", "ses:CreateReceiptRuleSet", "ses:DeleteReceiptRuleSet", "ses:DescribeReceiptRuleSet", "ses:CreateReceiptRule", "ses:DescribeReceiptRule", "ses:UpdateReceiptRule", "ses:DeleteReceiptRule", "ses:DescribeActiveReceiptRuleSet", "ses:SetActiveReceiptRuleSet", "ses:ListReceiptRuleSets"], Resource = "*", Condition = { StringEquals = { "aws:RequestedRegion" = var.region } } },
    { Sid = "UnsubscribeOwnTopic", Effect = "Allow", Action = ["sns:Unsubscribe"], Resource = local.topic_arn },
  ] })
}

resource "terraform_data" "identity_guard" {
  input = var.name
  lifecycle {
    precondition {
      condition     = data.aws_caller_identity.current.account_id == var.account_id && data.aws_caller_identity.current.arn == var.source_session_arn && data.aws_region.current.region == var.region
      error_message = "Bootstrap provider identity, account, or region does not match the approved inputs."
    }
  }
}

resource "aws_iam_policy" "provisioner" {
  name       = "${var.name}-provisioner"
  policy     = local.provisioner_policy
  tags       = local.tags
  depends_on = [terraform_data.identity_guard]
}
resource "aws_iam_policy" "reader" {
  name       = "${var.name}-reader"
  policy     = local.reader_policy
  tags       = local.tags
  depends_on = [terraform_data.identity_guard]
}
resource "aws_iam_policy" "sender" {
  name       = "${var.name}-sender"
  policy     = local.sender_policy
  tags       = local.tags
  depends_on = [terraform_data.identity_guard]
}
resource "aws_iam_policy" "indexer" {
  name       = "${var.name}-indexer"
  policy     = local.indexer_policy
  tags       = local.tags
  depends_on = [terraform_data.identity_guard]
}

resource "aws_iam_role" "provisioner" {
  name                 = "${var.name}-provisioner"
  assume_role_policy   = local.source_trust
  permissions_boundary = local.policy_arns.provisioner
  max_session_duration = 3600
  tags                 = local.tags
  depends_on           = [aws_iam_policy.provisioner]
}
resource "aws_iam_role" "reader" {
  name                 = "${var.name}-reader"
  assume_role_policy   = local.reader_trust
  permissions_boundary = local.policy_arns.reader
  max_session_duration = 3600
  tags                 = local.tags
  depends_on           = [aws_iam_policy.reader]
}
resource "aws_iam_role" "sender" {
  name                 = "${var.name}-sender"
  assume_role_policy   = local.source_trust
  permissions_boundary = local.policy_arns.sender
  max_session_duration = 3600
  tags                 = local.tags
  depends_on           = [aws_iam_policy.sender]
}
resource "aws_iam_role" "indexer" {
  name                 = "${var.name}-indexer"
  assume_role_policy   = local.indexer_trust
  permissions_boundary = local.policy_arns.indexer
  max_session_duration = 3600
  tags                 = local.tags
  depends_on           = [aws_iam_policy.indexer]
}

resource "aws_iam_role_policy_attachment" "provisioner" {
  role       = aws_iam_role.provisioner.name
  policy_arn = aws_iam_policy.provisioner.arn
}
resource "aws_iam_role_policy_attachment" "reader" {
  role       = aws_iam_role.reader.name
  policy_arn = aws_iam_policy.reader.arn
}
resource "aws_iam_role_policy_attachment" "sender" {
  role       = aws_iam_role.sender.name
  policy_arn = aws_iam_policy.sender.arn
}
resource "aws_iam_role_policy_attachment" "indexer" {
  role       = aws_iam_role.indexer.name
  policy_arn = aws_iam_policy.indexer.arn
}

output "role_arns" {
  value = {
    provisioner = aws_iam_role.provisioner.arn
    reader      = aws_iam_role.reader.arn
    sender      = aws_iam_role.sender.arn
    indexer     = aws_iam_role.indexer.arn
  }
}
output "bucket_name" {
  value = local.bucket
}
output "policy_documents" {
  value = { provisioner = local.provisioner_policy, reader = local.reader_policy, sender = local.sender_policy, indexer = local.indexer_policy }
}
